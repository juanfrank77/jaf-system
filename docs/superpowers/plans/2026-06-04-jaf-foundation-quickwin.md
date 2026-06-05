# JAF Operations Platform — Plan 1 (v2): Foundation + Quick Win

**Supersedes:** `2026-06-02-jaf-foundation-quickwin.md`

**Goal:** Close the maintenance accountability loop — supervisor intake → dual-signed warehouse pickup (or van bypass) → crew field update → supervisor reviews complete invoice + Claro submission helper → Lissette generates LC request → receivables dashboard tracks payment.

**Architecture:** React Router v7 (framework mode) serves both the SSR app and API actions. PostgreSQL via Prisma is the single source of truth. better-auth handles session-based auth with 5 RBAC roles. The crew field update route is cached offline via vite-plugin-pwa + Workbox.

**Tech Stack:** React Router v7, PostgreSQL (Neon dev / on-premise prod), Prisma ORM, better-auth, Tailwind CSS, shadcn/ui, vite-plugin-pwa + Workbox, SignaturePad.js, @react-pdf/renderer

> **Scope note:** This plan covers Weeks 1–4 only.
> - Plan 2 (Weeks 5–6): Module 1 — Van Restock, Consignment Ledger, Inventory Dashboard
> - Plan 3 (Month 2): Module 2A + 3 — Installation field ops, unified reconciliation

---

## What Changed from v1

| Area | Change |
|---|---|
| Central entity | Renamed `JafControlDoc` → `JafInvoice` (`@@map("jaf_invoice")`) throughout |
| Schema | Added `Warehouse`, `SystemSetting`, `VanRestockRequest`, `ConsignmentReceipt` models; added dual-sig fields, override fields, payment tracking fields to `JafInvoice`; `warehouseId` moved to signing step |
| Permissions | `FIELD_UPDATED` now accepts `from: ['SIGNED', 'CREATED']` — direct crew bypass when van materials sufficient |
| Sign route | Two sequential signatures: warehouse person releases, crew receives; warehouse selection added |
| Review route | Photos displayed inline; Claro submission helper section added |
| LC route | IVU rate fetched from `system_settings` — not hardcoded; removed state/municipal split |
| New: Task 13 | System settings admin UI (IVU rate) |
| New: Task 14 | Receivables aging dashboard (Finance) |
| New: Task 15 | One-click audit package PDF |

**Simple renames in unchanged tasks:** Every `db.jafControlDoc` → `db.jafInvoice`, every `JafControlDoc` type → `JafInvoice`.

---

## File Map

```
jaf-operations/
├── app/
│   ├── root.tsx
│   ├── entry.client.tsx
│   ├── entry.server.tsx
│   ├── routes/
│   │   ├── _auth.tsx
│   │   ├── _auth.login.tsx
│   │   ├── _app.tsx                              # + notification bell
│   │   ├── _app.dashboard.tsx                    # db.jafInvoice
│   │   ├── _app.docs.new.tsx                     # db.jafInvoice
│   │   ├── _app.docs.$id.tsx                     # db.jafInvoice
│   │   ├── _app.docs.$id_.prep.tsx               # db.jafInvoice
│   │   ├── _app.docs.$id_.sign.tsx               # CHANGED: dual signatures + warehouse
│   │   ├── _app.docs.$id_.field.tsx              # db.jafInvoice; audit trail before = doc.status
│   │   ├── _app.docs.$id_.review.tsx             # CHANGED: photos + Claro submission helper
│   │   ├── _app.docs.$id_.lc.tsx                 # CHANGED: IVU from system_settings
│   │   ├── _app.docs.$id_.audit-package.tsx      # NEW
│   │   ├── _app.finance.receivables.tsx          # NEW
│   │   ├── _app.admin.catalog.tsx
│   │   ├── _app.admin.settings.tsx               # NEW
│   │   ├── _app.admin.users.tsx
│   │   ├── api.auth.$.tsx
│   │   └── files.$.tsx
│   ├── components/
│   │   ├── signature-pad.tsx
│   │   ├── material-line-items.tsx
│   │   └── status-badge.tsx
│   ├── lib/
│   │   ├── auth.server.ts
│   │   ├── db.server.ts
│   │   ├── control-number.server.ts              # db.jafInvoice
│   │   ├── permissions.server.ts                 # CHANGED: new transition
│   │   ├── notifications.server.ts
│   │   └── pdf/
│   │       ├── warehouse-receipt.server.tsx
│   │       ├── acta-conformidad.server.tsx       # CHANGED: IVU as param
│   │       ├── schedule-accounts.server.tsx
│   │       └── audit-package.server.tsx          # NEW
│   └── sw.ts
├── prisma/
│   ├── schema.prisma                             # CHANGED: new models + fields
│   └── seed.ts                                   # CHANGED: warehouses + system_settings
└── ...
```

---

## Task 1: Project Scaffold

*(Identical to v1. Follow all steps from `2026-06-02-jaf-foundation-quickwin.md` Task 1.)*

---

## Task 2: Database Schema

**Files:**
- Rewrite: `prisma/schema.prisma`
- Rewrite: `prisma/seed.ts`
- Create: `app/lib/db.server.ts`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write schema.prisma**

Replace `prisma/schema.prisma` entirely:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  SUPERVISOR
  CREW
  WAREHOUSE
  FINANCE
  ADMIN
}

enum DocStatus {
  CREATED
  PREPPED
  SIGNED
  FIELD_UPDATED
  SUPERVISOR_APPROVED
  CLARO_UPLOADED
  LC_GENERATED
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  role      Role
  phone     String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  sessions Session[]
  accounts Account[]

  supervisedInvoices    JafInvoice[]         @relation("SupervisorDocs")
  preppedInvoices       JafInvoice[]         @relation("PreppedDocs")
  releasedInvoices      JafInvoice[]         @relation("ReleasedDocs")
  signedInvoices        JafInvoice[]         @relation("SignedDocs")
  overriddenInvoices    JafInvoice[]         @relation("OverriddenDocs")
  lcApprovedInvoices    JafInvoice[]         @relation("LcApprovedDocs")
  closedReceivables     JafInvoice[]         @relation("ClosedReceivables")
  restockRequests       VanRestockRequest[]  @relation("RestockRequests")
  restockReleases       VanRestockRequest[]  @relation("RestockReleases")
  restockReceivers      VanRestockRequest[]  @relation("RestockReceivers")
  restockOverrides      VanRestockRequest[]  @relation("RestockOverrides")
  consignmentReceipts   ConsignmentReceipt[] @relation("ConsignmentReceipts")
  systemSettings        SystemSetting[]      @relation("SystemSettings")
  auditTrail            AuditTrail[]
  photos                Photo[]
  notifications         Notification[]
}

model Session {
  id        String   @id
  userId    String
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                      String    @id @default(cuid())
  userId                  String
  accountId               String
  providerId              String
  accessToken             String?
  refreshToken            String?
  idToken                 String?
  accessTokenExpiresAt    DateTime?
  refreshTokenExpiresAt   DateTime?
  scope                   String?
  password                String?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Warehouse {
  id       String   @id @default(cuid())
  name     String
  zone     String
  location String?
  active   Boolean  @default(true)

  invoices             JafInvoice[]
  vanRestockRequests   VanRestockRequest[]
  consignmentReceipts  ConsignmentReceipt[]
}

model JafInvoice {
  id            String    @id @default(cuid())
  controlNumber String    @unique
  status        DocStatus @default(CREATED)

  // Supervisor fills at intake
  jobType             String
  jobAddressEstimated String
  estimatedMaterials  Json
  assignedCrewIds     String[]
  supervisorId        String
  supervisor          User     @relation("SupervisorDocs", fields: [supervisorId], references: [id])
  avisoNumber         String?
  createdAt           DateTime @default(now())

  // Warehouse prep (Step 2)
  preppedAt   DateTime?
  preppedById String?
  preppedBy   User?    @relation("PreppedDocs", fields: [preppedById], references: [id])

  // Dual signature at warehouse pickup (Step 3) — materialsTaken locked after this
  // warehouseId set here, not at prep — crew may pull from a different zone warehouse
  warehouseId      String?
  warehouse        Warehouse? @relation(fields: [warehouseId], references: [id])
  materialsTaken   Json?
  releaseSignature String?    // base64 — warehouse person signs (gives)
  releasedById     String?
  releasedBy       User?      @relation("ReleasedDocs", fields: [releasedById], references: [id])
  releaseSignedAt  DateTime?
  crewSignature    String?    // base64 — crew member signs (receives)
  signedById       String?
  signedBy         User?      @relation("SignedDocs", fields: [signedById], references: [id])
  signedAt         DateTime?

  // Admin override
  overriddenById    String?
  overriddenBy      User?    @relation("OverriddenDocs", fields: [overriddenById], references: [id])
  overrideSignature String?
  overrideAt        DateTime?
  overrideReason    String?

  // Crew field update (Step 4)
  jobAddressActual String?
  materialsUsed    Json?
  fieldNotes       String?
  completedAt      DateTime?

  // Supervisor approval + Claro submission (Step 5)
  supervisorApprovedAt DateTime?
  claroNotes           String?
  claroPdfPath         String?
  claroUploadedAt      DateTime?

  // Lissette generates LC (Step 6)
  lcRequestPdfPath String?
  lcGeneratedAt    DateTime?
  lcApprovedById   String?
  lcApprovedBy     User?     @relation("LcApprovedDocs", fields: [lcApprovedById], references: [id])

  // Payment tracking (receivables dashboard)
  advanceReceivedAt      DateTime?
  advanceAmount          Decimal?
  finalPaymentReceivedAt DateTime?
  finalPaymentAmount     Decimal?
  receivableClosedAt     DateTime?
  receivableClosedById   String?
  receivableClosedBy     User?     @relation("ClosedReceivables", fields: [receivableClosedById], references: [id])

  // Generated documents
  warehouseReceiptPath String?

  auditTrail AuditTrail[]
  photos     Photo[]
  poLinks    PoLink[]

  @@map("jaf_invoice")
}

model AuditTrail {
  id        String     @id @default(cuid())
  docId     String
  doc       JafInvoice @relation(fields: [docId], references: [id])
  userId    String
  user      User       @relation(fields: [userId], references: [id])
  action    String
  diffJson  Json
  timestamp DateTime   @default(now())
}

model Photo {
  id           String     @id @default(cuid())
  docId        String
  doc          JafInvoice @relation(fields: [docId], references: [id])
  uploadedById String
  uploadedBy   User       @relation(fields: [uploadedById], references: [id])
  localPath    String
  takenAt      DateTime   @default(now())
}

model ServiceCode {
  id             String  @id @default(cuid())
  claroCode      String  @unique
  name           String
  description    String?
  unit           String  @default("SR")
  unitPrice      Decimal
  accountCode    String?
  subAct         String?
  dept           String?
  profitCenter   String?
  act            String?
  costCenterCode String?
  active         Boolean @default(true)
}

model PoLink {
  id               String     @id @default(cuid())
  docId            String
  doc              JafInvoice @relation(fields: [docId], references: [id])
  claroPONumber    String
  acceptanceNumber String?
  amount           Decimal?
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  message   String
  docId     String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
}

model SystemSetting {
  id          String   @id @default(cuid())
  key         String   @unique
  value       String
  updatedById String
  updatedBy   User     @relation("SystemSettings", fields: [updatedById], references: [id])
  updatedAt   DateTime @updatedAt
}

// Module 1 tables — schema defined now, routes built in Plan 2
model VanRestockRequest {
  id                 String    @id @default(cuid())
  requestedById      String
  requestedBy        User      @relation("RestockRequests", fields: [requestedById], references: [id])
  warehouseId        String
  warehouse          Warehouse @relation(fields: [warehouseId], references: [id])
  items              Json
  status             String    @default("REQUESTED")
  releaseSignature   String?
  releasedById       String?
  releasedBy         User?     @relation("RestockReleases", fields: [releasedById], references: [id])
  releaseSignedAt    DateTime?
  receiverSignature  String?
  receiverSignedById String?
  receiverSignedBy   User?     @relation("RestockReceivers", fields: [receiverSignedById], references: [id])
  receiverSignedAt   DateTime?
  overriddenById     String?
  overriddenBy       User?     @relation("RestockOverrides", fields: [overriddenById], references: [id])
  overrideSignature  String?
  overrideAt         DateTime?
  overrideReason     String?
  createdAt          DateTime  @default(now())
}

model ConsignmentReceipt {
  id           String    @id @default(cuid())
  warehouseId  String
  warehouse    Warehouse @relation(fields: [warehouseId], references: [id])
  receivedById String
  receivedBy   User      @relation("ConsignmentReceipts", fields: [receivedById], references: [id])
  deliveryDate DateTime
  items        Json
  notes        String?
  createdAt    DateTime  @default(now())
}
```

- [ ] **Step 3: Create db.server.ts singleton**

Create `app/lib/db.server.ts`:

```ts
import { PrismaClient } from '@prisma/client'

declare global {
  var __db__: PrismaClient | undefined
}

let db: PrismaClient

if (process.env.NODE_ENV === 'production') {
  db = new PrismaClient()
} else {
  if (!global.__db__) {
    global.__db__ = new PrismaClient()
  }
  db = global.__db__
}

export { db }
```

- [ ] **Step 4: Run migration against Neon**

```bash
npx prisma migrate dev --name init
```

Expected: Migration created and applied. Prisma client generated.

- [ ] **Step 5: Write seed.ts**

Create `prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client'
import { hash } from 'better-auth/crypto'

const db = new PrismaClient()

async function main() {
  const password = await hash('jaf2026!')

  const users = [
    { email: 'supervisor@jaf.com', name: 'Supervisor Test', role: 'SUPERVISOR' as const },
    { email: 'crew@jaf.com', name: 'Crew Test', role: 'CREW' as const },
    { email: 'idalia@jaf.com', name: 'Idalia (Warehouse)', role: 'WAREHOUSE' as const },
    { email: 'lissette@jaf.com', name: 'Lissette (Finance)', role: 'FINANCE' as const },
    { email: 'admin@jaf.com', name: 'Admin', role: 'ADMIN' as const },
  ]

  for (const u of users) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role },
    })
    await db.account.upsert({
      where: { id: `seed-${u.email}` },
      update: {},
      create: {
        id: `seed-${u.email}`,
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password,
      },
    })
  }

  // 3 zone warehouses — names are placeholders; update before go-live (Open Item)
  const warehouses = [
    { name: 'Warehouse Norte', zone: 'Norte', location: 'Zona Norte' },
    { name: 'Warehouse Centro', zone: 'Centro', location: 'Zona Centro' },
    { name: 'Warehouse Sur', zone: 'Sur', location: 'Zona Sur' },
  ]
  for (const w of warehouses) {
    await db.warehouse.upsert({
      where: { id: `seed-${w.zone}` },
      update: {},
      create: { id: `seed-${w.zone}`, ...w },
    })
  }

  // Sample service codes from Claro contract
  const codes = [
    { claroCode: '34006428', name: 'REMOCION MENSAJERO', unitPrice: 0.36, accountCode: '6200', dept: 'PWOR' },
    { claroCode: '34006429', name: 'INSTALACION MENSAJERO', unitPrice: 0.52, accountCode: '6200', dept: 'PWOR' },
    { claroCode: '34006430', name: 'MANTENIMIENTO GENERAL', unitPrice: 0.44, accountCode: '6210', dept: 'PWOR' },
  ]
  for (const c of codes) {
    await db.serviceCode.upsert({
      where: { claroCode: c.claroCode },
      update: {},
      create: { unit: 'SR', ...c },
    })
  }

  // Default IVU rate — admin can change via /admin/settings
  // Confirm actual rate with management before go-live (Open Item)
  const adminUser = await db.user.findUniqueOrThrow({ where: { email: 'admin@jaf.com' } })
  await db.systemSetting.upsert({
    where: { key: 'ivu_rate' },
    update: {},
    create: { key: 'ivu_rate', value: '0.115', updatedById: adminUser.id },
  })

  console.log('Seed complete')
}

main().catch(console.error).finally(() => db.$disconnect())
```

Add to `package.json`:
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

Install tsx: `npm install -D tsx`

- [ ] **Step 6: Run seed**

```bash
npx prisma db seed
```

Expected: "Seed complete" — 5 users, 3 warehouses, 3 service codes, 1 system setting.

- [ ] **Step 7: Verify with Prisma Studio**

```bash
npx prisma studio
```

Confirm users, warehouses, service codes, and the `ivu_rate` system setting exist.

- [ ] **Step 8: Commit**

```bash
git add prisma/ app/lib/db.server.ts package.json
git commit -m "feat: prisma schema v2 — JafInvoice, Warehouse, SystemSetting + migration + seed"
```

---

## Task 3: Auth + RBAC

**Files:**
- Create: `app/lib/auth.server.ts`
- Create: `app/lib/permissions.server.ts`
- Create: `app/routes/_auth.login.tsx`, `app/routes/_app.tsx`, `app/routes/api.auth.$.tsx`

- [ ] **Step 1: Configure better-auth**

Create `app/lib/auth.server.ts`:

```ts
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { db } from './db.server'

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
})

export type Session = typeof auth.$Infer.Session
```

- [ ] **Step 2: Create permissions helper**

Create `app/lib/permissions.server.ts`:

```ts
import { redirect } from 'react-router'
import { auth } from './auth.server'
import { db } from './db.server'
import type { Role } from '@prisma/client'

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect('/login')
  return session
}

export async function requireRole(request: Request, allowed: Role[]) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })
  if (!allowed.includes(user.role)) throw redirect('/dashboard')
  return { session, user }
}

const TRANSITIONS: Record<string, { from: string | string[]; roles: Role[] }> = {
  PREPPED:             { from: 'CREATED',                       roles: ['WAREHOUSE', 'ADMIN'] },
  SIGNED:              { from: 'PREPPED',                       roles: ['CREW', 'WAREHOUSE', 'ADMIN'] },
  // FIELD_UPDATED accepts from SIGNED (warehouse path) OR CREATED (van bypass path)
  FIELD_UPDATED:       { from: ['SIGNED', 'CREATED'],           roles: ['CREW', 'ADMIN'] },
  SUPERVISOR_APPROVED: { from: 'FIELD_UPDATED',                 roles: ['SUPERVISOR', 'ADMIN'] },
  CLARO_UPLOADED:      { from: 'SUPERVISOR_APPROVED',           roles: ['SUPERVISOR', 'ADMIN'] },
  LC_GENERATED:        { from: 'CLARO_UPLOADED',                roles: ['FINANCE', 'ADMIN'] },
}

export function canTransition(currentStatus: string, targetStatus: string, role: Role): boolean {
  const rule = TRANSITIONS[targetStatus]
  if (!rule) return false
  const validFrom = Array.isArray(rule.from) ? rule.from : [rule.from]
  return validFrom.includes(currentStatus) && rule.roles.includes(role)
}
```

- [ ] **Step 3: Add better-auth API route**

Create `app/routes/api.auth.$.tsx`:

```ts
import { auth } from '~/lib/auth.server'
import type { Route } from './+types/api.auth.$'

export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request)
}
export async function action({ request }: Route.ActionArgs) {
  return auth.handler(request)
}
```

- [ ] **Step 4: Create login route**

*(Identical to v1 — follow Task 3 Step 4 from `2026-06-02-jaf-foundation-quickwin.md`.)*

- [ ] **Step 5: Create app shell**

*(Identical to v1 — follow Task 3 Step 5 from `2026-06-02-jaf-foundation-quickwin.md`.)*

- [ ] **Step 6: Test auth flow manually and commit**

```bash
npm run dev
```

1. Visit http://localhost:5173 → redirects to /login
2. Log in as supervisor@jaf.com / jaf2026! → redirects to /dashboard (404 OK for now)

```bash
git add app/lib/auth.server.ts app/lib/permissions.server.ts app/routes/
git commit -m "feat: better-auth + RBAC with CREATED→FIELD_UPDATED van bypass path"
```

---

## Task 4: Control Number Engine

*(Same as v1, but change `db.jafControlDoc.count` → `db.jafInvoice.count` in `app/lib/control-number.server.ts` and in the test mock.)*

Follow all steps from v1 Task 4, applying that rename. The test, implementation, and commit are otherwise identical.

---

## Task 5: Service Catalog + Dashboard

*(Same as v1, but change all `db.jafControlDoc` → `db.jafInvoice` in `app/routes/_app.dashboard.tsx`.)*

Follow all steps from v1 Task 5 with that rename applied.

---

## Task 6: Supervisor Creates JAF Invoice

*(Same as v1, but:)*
- *Change `db.jafControlDoc.create` → `db.jafInvoice.create`*
- *Change `db.jafControlDoc.findUniqueOrThrow` → `db.jafInvoice.findUniqueOrThrow` throughout*

Follow all steps from v1 Task 6 with those renames applied.

---

## Task 7: Idalia's Warehouse View + Prep

*(Same as v1, but change all `db.jafControlDoc` → `db.jafInvoice`. Note: do NOT set `warehouseId` at prep time — it is set at signing.)*

Follow all steps from v1 Task 7 with those renames applied.

---

## Task 8: Crew Dual Signature at Warehouse

**Files:**
- Create: `app/components/signature-pad.tsx` *(unchanged from v1)*
- Rewrite: `app/routes/_app.docs.$id_.sign.tsx`
- Create: `app/lib/pdf/warehouse-receipt.server.tsx` *(unchanged from v1 except Prisma type name)*

- [ ] **Step 1: Create SignaturePad wrapper**

*(Identical to v1 — follow Task 8 Step 1 from `2026-06-02-jaf-foundation-quickwin.md`.)*

- [ ] **Step 2: Create dual-signature sign route**

Create `app/routes/_app.docs.$id_.sign.tsx`:

```tsx
import { useRef, useState } from 'react'
import { Form, redirect, useSubmit } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { canTransition } from '~/lib/permissions.server'
import { generateWarehouseReceiptPdf } from '~/lib/pdf/warehouse-receipt.server'
import { SignaturePad, type SignaturePadHandle } from '~/components/signature-pad'
import { MaterialLineItems } from '~/components/material-line-items'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import type { Route } from './+types/_app.docs.$id_.sign'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['CREW', 'WAREHOUSE', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'SIGNED', user.role)) throw redirect(`/docs/${params.id}`)
  const serviceCodes = await db.serviceCode.findMany({ where: { active: true } })
  const warehouses = await db.warehouse.findMany({ where: { active: true } })
  return { doc, user, serviceCodes, warehouses }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['CREW', 'WAREHOUSE', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'SIGNED', user.role)) throw redirect(`/docs/${params.id}`)

  const form = await request.formData()
  const releaseSignature = form.get('releaseSignature') as string
  const crewSignature = form.get('crewSignature') as string
  const warehouseId = form.get('warehouseId') as string
  const materialsRaw = form.get('materials') as string

  if (!releaseSignature || releaseSignature === 'data:,') {
    return { error: 'Warehouse release signature is required' }
  }
  if (!crewSignature || crewSignature === 'data:,') {
    return { error: 'Crew receipt signature is required' }
  }
  if (!warehouseId) {
    return { error: 'Please select the warehouse' }
  }

  let materialsTaken: { serviceCodeId: string; qty: number }[] = []
  try {
    materialsTaken = JSON.parse(materialsRaw).filter((i: any) => i.serviceCodeId && i.qty > 0)
  } catch {
    return { error: 'Invalid materials data' }
  }

  await db.jafInvoice.update({
    where: { id: params.id },
    data: {
      status: 'SIGNED',
      warehouseId,
      materialsTaken,
      releaseSignature,
      releasedById: user.id,
      releaseSignedAt: new Date(),
      crewSignature,
      signedById: user.id,
      signedAt: new Date(),
    },
  })

  await db.auditTrail.create({
    data: {
      docId: params.id,
      userId: user.id,
      action: 'STATUS_CHANGED',
      diffJson: { status: { before: 'PREPPED', after: 'SIGNED' }, warehouseId, materialsTaken },
    },
  })

  const updatedDoc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  const serviceCodes = await db.serviceCode.findMany()
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } })
  const pdfBytes = await generateWarehouseReceiptPdf(updatedDoc as any, serviceCodes as any, warehouse?.name ?? '')
  const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
  const receiptDir = path.join(uploadDir, 'receipts')
  await fs.mkdir(receiptDir, { recursive: true })
  const receiptPath = path.join(receiptDir, `${params.id}-receipt.pdf`)
  await fs.writeFile(receiptPath, pdfBytes)
  await db.jafInvoice.update({
    where: { id: params.id },
    data: { warehouseReceiptPath: receiptPath },
  })

  throw redirect(`/docs/${params.id}`)
}

export default function SignDoc({ loaderData, actionData }: Route.ComponentProps) {
  const { doc, serviceCodes, warehouses } = loaderData
  const releaseRef = useRef<SignaturePadHandle>(null)
  const crewRef = useRef<SignaturePadHandle>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [items, setItems] = useState((doc.estimatedMaterials as any[]) || [])
  const submit = useSubmit()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!warehouseId) { alert('Please select the warehouse.'); return }
    if (releaseRef.current?.isEmpty()) { alert('Warehouse release signature is required.'); return }
    if (crewRef.current?.isEmpty()) { alert('Crew receipt signature is required.'); return }
    const formData = new FormData(e.currentTarget)
    formData.set('releaseSignature', releaseRef.current!.toDataURL())
    formData.set('crewSignature', crewRef.current!.toDataURL())
    formData.set('materials', JSON.stringify(items))
    formData.set('warehouseId', warehouseId)
    submit(formData, { method: 'post' })
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Warehouse Pickup — Dual Signature</h1>
      <p className="text-sm font-mono text-slate-500">{(doc as any).controlNumber}</p>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        Review materials below. Add any items not on the estimated list. Both warehouse and crew must sign. Once signed, this list is permanently locked.
      </div>

      <Form method="post" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select warehouse..." />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name} — {w.zone}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Materials Taken</Label>
          <div className="mt-1">
            <MaterialLineItems
              serviceCodes={serviceCodes as any}
              initialItems={items}
              readOnly={false}
              name="materials"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium mb-1">1. Warehouse Release Signature</p>
            <p className="text-xs text-slate-500 mb-2">Person releasing materials signs here</p>
            <SignaturePad ref={releaseRef} width={320} height={120} />
            <button type="button" onClick={() => releaseRef.current?.clear()} className="text-xs text-slate-400 mt-1 hover:text-slate-600">Clear</button>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">2. Crew Receipt Signature</p>
            <p className="text-xs text-slate-500 mb-2">Crew member receiving materials signs here</p>
            <SignaturePad ref={crewRef} width={320} height={120} />
            <button type="button" onClick={() => crewRef.current?.clear()} className="text-xs text-slate-400 mt-1 hover:text-slate-600">Clear</button>
          </div>
        </div>

        {(actionData as any)?.error && (
          <p className="text-sm text-red-600">{(actionData as any).error}</p>
        )}

        <Button type="submit" className="w-full bg-red-700 hover:bg-red-800">
          Sign & Lock Materials
        </Button>
      </Form>
    </div>
  )
}
```

- [ ] **Step 3: Update warehouse receipt PDF generator**

Update `app/lib/pdf/warehouse-receipt.server.tsx` — add `warehouseName` param and render both signatures. Replace the function signature and the signature section:

```tsx
export async function generateWarehouseReceiptPdf(
  doc: {
    controlNumber: string
    jobType: string
    jobAddressEstimated: string
    avisoNumber?: string | null
    materialsTaken: { serviceCodeId: string; qty: number }[]
    releaseSignature?: string | null
    crewSignature?: string | null
    signedAt?: Date | null
  },
  serviceCodes: { id: string; claroCode: string; name: string; unit: string; unitPrice: number }[],
  warehouseName: string
): Promise<Buffer>
```

In the JSX, replace the single signature section with:

```tsx
<View style={styles.signatureSection}>
  <View style={{ flexDirection: 'row', gap: 24 }}>
    <View style={{ flex: 1 }}>
      <Text style={{ marginBottom: 4, fontSize: 9 }}>Warehouse Release:</Text>
      {doc.releaseSignature && (
        <Image src={doc.releaseSignature} style={{ height: 40, width: 160 }} />
      )}
      <Text style={{ marginTop: 2, fontSize: 8, color: '#666' }}>{warehouseName}</Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={{ marginBottom: 4, fontSize: 9 }}>Crew Receipt:</Text>
      {doc.crewSignature && (
        <Image src={doc.crewSignature} style={{ height: 40, width: 160 }} />
      )}
      <Text style={{ marginTop: 2, fontSize: 8, color: '#666' }}>
        {doc.signedAt ? new Date(doc.signedAt).toLocaleString() : ''}
      </Text>
    </View>
  </View>
</View>
```

- [ ] **Step 4: Test dual signature flow manually**

1. Create a doc as supervisor, have Idalia mark PREPPED
2. Log in as crew or warehouse, go to `/docs/<id>/sign`
3. Select a warehouse, add a material, draw both signatures, submit
4. Confirm status = SIGNED, both signatures visible in doc view
5. Confirm warehouse receipt PDF generated in `/tmp/jaf/uploads/receipts/`

- [ ] **Step 5: Commit**

```bash
git add app/routes/_app.docs.$id_.sign.tsx app/components/signature-pad.tsx app/lib/pdf/warehouse-receipt.server.tsx
git commit -m "feat: dual-signature warehouse pickup — release + receipt + warehouse attribution"
```

---

## Task 9: Crew Field Update (Offline-Capable PWA)

*(Same as v1 Task 9, with two changes:)*

1. *Change `db.jafControlDoc` → `db.jafInvoice` throughout*
2. *In the audit trail `diffJson`, change hardcoded `before: 'SIGNED'` to `before: doc.status` — handles both SIGNED→FIELD_UPDATED and CREATED→FIELD_UPDATED paths*

```ts
diffJson: { status: { before: doc.status, after: 'FIELD_UPDATED' }, jobAddressActual, materialsUsed },
```

Also update the photo note in the UI from "Photos stored as proof of work — not sent externally" to "Photos are source data for the supervisor's Claro submission — stored on server."

Follow all other steps from v1 Task 9 unchanged.

---

## Task 10: Supervisor Review + Claro Submission Helper

**Files:**
- Rewrite: `app/routes/_app.docs.$id_.review.tsx`

- [ ] **Step 1: Create supervisor review route with photos + Claro helper**

Create `app/routes/_app.docs.$id_.review.tsx`:

```tsx
import { Form, redirect } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { canTransition } from '~/lib/permissions.server'
import { MaterialLineItems } from '~/components/material-line-items'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import type { Route } from './+types/_app.docs.$id_.review'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['SUPERVISOR', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  const serviceCodes = await db.serviceCode.findMany()
  const photos = await db.photo.findMany({ where: { docId: params.id } })
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  return { doc, user, serviceCodes, photos, supervisor }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['SUPERVISOR', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'approve') {
    if (!canTransition(doc.status, 'SUPERVISOR_APPROVED', user.role)) throw redirect(`/docs/${params.id}`)
    const avisoNumber = (form.get('avisoNumber') as string | null)?.trim() || doc.avisoNumber
    const claroNotes = (form.get('claroNotes') as string | null)?.trim() || null
    await db.jafInvoice.update({
      where: { id: params.id },
      data: { status: 'SUPERVISOR_APPROVED', supervisorApprovedAt: new Date(), avisoNumber, claroNotes },
    })
    await db.auditTrail.create({
      data: {
        docId: params.id, userId: user.id, action: 'STATUS_CHANGED',
        diffJson: { status: { before: 'FIELD_UPDATED', after: 'SUPERVISOR_APPROVED' } },
      },
    })
  }

  if (intent === 'upload_claro') {
    if (!canTransition(doc.status, 'CLARO_UPLOADED', user.role)) throw redirect(`/docs/${params.id}`)
    const claroPdf = form.get('claroPdf') as File
    if (!claroPdf || claroPdf.size === 0) return { error: 'Please select the Claro PDF to upload' }
    const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
    const claroDir = path.join(uploadDir, 'claro-pdfs')
    await fs.mkdir(claroDir, { recursive: true })
    const localPath = path.join(claroDir, `${params.id}-claro.pdf`)
    await fs.writeFile(localPath, Buffer.from(await claroPdf.arrayBuffer()))
    await db.jafInvoice.update({
      where: { id: params.id },
      data: { status: 'CLARO_UPLOADED', claroPdfPath: localPath, claroUploadedAt: new Date() },
    })
    await db.auditTrail.create({
      data: {
        docId: params.id, userId: user.id, action: 'STATUS_CHANGED',
        diffJson: { status: { before: 'SUPERVISOR_APPROVED', after: 'CLARO_UPLOADED' } },
      },
    })
    const finance = await db.user.findMany({ where: { role: 'FINANCE', active: true } })
    await db.notification.createMany({
      data: finance.map((f) => ({
        userId: f.id, docId: params.id,
        message: `Job ${doc.controlNumber} Claro work order uploaded. Ready for LC request.`,
      })),
    })
  }

  throw redirect(`/docs/${params.id}`)
}

export default function ReviewDoc({ loaderData, actionData }: Route.ComponentProps) {
  const { doc, serviceCodes, photos, supervisor } = loaderData
  const estimated = (doc.estimatedMaterials as any[]) || []
  const taken = (doc.materialsTaken as any[]) || []
  const used = (doc.materialsUsed as any[]) || []
  const isApproved = ['SUPERVISOR_APPROVED', 'CLARO_UPLOADED', 'LC_GENERATED'].includes(doc.status)

  // Build Claro submission helper data
  const codeMap = Object.fromEntries((serviceCodes as any[]).map((c: any) => [c.id, c]))
  const takenItems = taken.map((t: any) => {
    const code = codeMap[t.serviceCodeId]
    return { claroCode: code?.claroCode, name: code?.name, qty: t.qty, unit: code?.unit }
  })

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Supervisor Review</h1>
      <p className="font-mono text-sm text-slate-500">{(doc as any).controlNumber}</p>

      {/* Materials variance */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">Estimated</p>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={estimated} readOnly />
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">Taken (Signed)</p>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={taken} readOnly />
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">Used (Field)</p>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={used} readOnly />
        </div>
      </div>

      {/* Job address comparison */}
      <div className="bg-white border rounded-lg p-4 text-sm space-y-1">
        <p><span className="text-slate-500">Estimated address:</span> {(doc as any).jobAddressEstimated}</p>
        {(doc as any).jobAddressActual && (
          <p><span className="text-slate-500">Actual address:</span> {(doc as any).jobAddressActual}</p>
        )}
        {(doc as any).fieldNotes && (
          <p><span className="text-slate-500">Field notes:</span> {(doc as any).fieldNotes}</p>
        )}
      </div>

      {/* Photos — source data for Claro submission */}
      {photos.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm font-medium mb-2">Job Photos ({photos.length})</p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={`/files/photos/${(doc as any).id}/${path.basename(p.localPath)}`} target="_blank" rel="noreferrer">
                <img
                  src={`/files/photos/${(doc as any).id}/${path.basename(p.localPath)}`}
                  alt="Job photo"
                  className="w-full h-24 object-cover rounded border"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Claro submission helper */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-blue-900 mb-2">Claro Portal — Submission Data</h2>
        <p className="text-xs text-blue-700 mb-3">Copy this data into Claro's portal to create the work order.</p>
        <div className="space-y-1 text-sm">
          <p><span className="font-medium">Aviso #:</span> {(doc as any).avisoNumber ?? '— (enter after creating in Claro)'}</p>
          <p><span className="font-medium">Job Type:</span> {(doc as any).jobType}</p>
          <p><span className="font-medium">Address:</span> {(doc as any).jobAddressActual ?? (doc as any).jobAddressEstimated}</p>
          <p><span className="font-medium">Supervisor:</span> {(loaderData as any).supervisor?.name}</p>
        </div>
        {takenItems.length > 0 && (
          <table className="w-full text-xs mt-3 border-collapse">
            <thead>
              <tr className="text-left text-blue-800 border-b border-blue-200">
                <th className="pb-1">Code</th>
                <th className="pb-1">Description</th>
                <th className="pb-1 text-right">Qty</th>
                <th className="pb-1 text-right">Unit</th>
              </tr>
            </thead>
            <tbody>
              {takenItems.map((item: any, i: number) => (
                <tr key={i} className="border-b border-blue-100">
                  <td className="py-1 font-mono">{item.claroCode}</td>
                  <td className="py-1">{item.name}</td>
                  <td className="py-1 text-right">{item.qty}</td>
                  <td className="py-1 text-right">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!isApproved && (
        <Form method="post" className="space-y-3 bg-white border rounded-lg p-4">
          <h2 className="font-medium text-sm">Approve Job</h2>
          <div>
            <Label htmlFor="avisoNumber">Claro Aviso # (confirm or add)</Label>
            <Input id="avisoNumber" name="avisoNumber" defaultValue={(doc as any).avisoNumber || ''} />
          </div>
          <div>
            <Label htmlFor="claroNotes">Notes for Lissette</Label>
            <Textarea id="claroNotes" name="claroNotes" rows={2} />
          </div>
          <input type="hidden" name="intent" value="approve" />
          <Button type="submit" className="w-full">Approve</Button>
        </Form>
      )}

      {doc.status === 'SUPERVISOR_APPROVED' && (
        <Form method="post" encType="multipart/form-data" className="space-y-3 bg-white border rounded-lg p-4">
          <h2 className="font-medium text-sm">Upload Claro Work Order PDF</h2>
          <p className="text-xs text-slate-500">After creating the work order in Claro's portal, download the PDF and upload it here.</p>
          <input type="hidden" name="intent" value="upload_claro" />
          <Input type="file" name="claroPdf" accept="application/pdf" required />
          {(actionData as any)?.error && <p className="text-sm text-red-600">{(actionData as any).error}</p>}
          <Button type="submit">Upload Claro PDF</Button>
        </Form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Test manually**

1. Complete a doc through FIELD_UPDATED with photos
2. Log in as supervisor, go to `/docs/<id>/review`
3. Confirm photos display inline
4. Confirm Claro submission helper shows service codes, address, job type
5. Approve → status = SUPERVISOR_APPROVED
6. Upload any PDF → status = CLARO_UPLOADED

- [ ] **Step 3: Commit**

```bash
git add app/routes/_app.docs.$id_.review.tsx
git commit -m "feat: supervisor review — inline photos + Claro submission helper"
```

---

## Task 11: Lissette's LC Request + PDF Generation

**Files:**
- Create: `app/routes/_app.docs.$id_.lc.tsx`
- Rewrite: `app/lib/pdf/acta-conformidad.server.tsx` *(IVU as param, not hardcoded)*
- Create: `app/lib/pdf/schedule-accounts.server.tsx`
- Create: `app/routes/files.$.tsx`

- [ ] **Step 1: Update Acta de Conformidad PDF generator (IVU from param)**

Create `app/lib/pdf/acta-conformidad.server.tsx`:

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 9 },
  title: { fontSize: 13, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 10, textAlign: 'center', marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  label: { color: '#555' },
  section: { marginTop: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 4, fontSize: 9 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#e2e8f0', padding: 3, fontSize: 8 },
  tableRow: { flexDirection: 'row', padding: 3, borderBottom: '0.5px solid #cbd5e1' },
  c1: { flex: 1.5 }, c2: { flex: 3 }, c3: { flex: 1, textAlign: 'right' },
  c4: { flex: 1, textAlign: 'right' }, c5: { flex: 1.5, textAlign: 'right' },
  c6: { flex: 1 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  bold: { fontWeight: 'bold' },
})

interface LineItem {
  claroCode: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  accountCode?: string | null
}

export async function generateActaConformidadPdf(params: {
  controlNumber: string
  avisoNumber?: string | null
  jobType: string
  jobAddress: string
  invoiceNumber: string
  invoiceDate: string
  lineItems: LineItem[]
  supervisorName: string
  ivuRate: number   // fetched from system_settings — never hardcoded
}): Promise<Buffer> {
  let subtotal = 0
  const items = params.lineItems.map((item) => {
    const amount = item.qty * item.unitPrice
    subtotal += amount
    return { ...item, amount }
  })
  const ivu = subtotal * params.ivuRate
  const total = subtotal + ivu

  const element = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>ACTA DE CONFORMIDAD</Text>
        <Text style={styles.subtitle}>JAF Communications, Inc.</Text>

        <View style={styles.headerRow}>
          <Text><Text style={styles.label}>Numero Suplidor: </Text>V0000000006</Text>
          <Text><Text style={styles.label}>Numero de Factura: </Text>{params.invoiceNumber}</Text>
          <Text><Text style={styles.label}>ORG: </Text>PWOR</Text>
          <Text><Text style={styles.label}>Fecha: </Text>{params.invoiceDate}</Text>
        </View>
        {params.avisoNumber && (
          <View style={styles.headerRow}>
            <Text><Text style={styles.label}>Orden Trabajo Planta: </Text>{params.avisoNumber}</Text>
            <Text><Text style={styles.label}>Control #: </Text>{params.controlNumber}</Text>
          </View>
        )}
        <View style={styles.headerRow}>
          <Text><Text style={styles.label}>Trabajo: </Text>{params.jobType}</Text>
          <Text><Text style={styles.label}>Zona: </Text>{params.jobAddress}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detalle de Servicios</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.c1}>Código</Text>
            <Text style={styles.c2}>Descripción</Text>
            <Text style={styles.c3}>Cant</Text>
            <Text style={styles.c4}>Precio Unit</Text>
            <Text style={styles.c5}>Importe</Text>
            <Text style={styles.c6}>A/C</Text>
          </View>
          {items.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.c1}>{item.claroCode}</Text>
              <Text style={styles.c2}>{item.name}</Text>
              <Text style={styles.c3}>{item.qty} {item.unit}</Text>
              <Text style={styles.c4}>${item.unitPrice.toFixed(4)}</Text>
              <Text style={styles.c5}>${item.amount.toFixed(2)}</Text>
              <Text style={styles.c6}>{item.accountCode ?? ''}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 12 }}>
          <View style={styles.totalRow}><Text>Subtotal: ${subtotal.toFixed(2)}</Text></View>
          <View style={styles.totalRow}>
            <Text>IVU ({(params.ivuRate * 100).toFixed(1)}%): ${ivu.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Total a Pagar: ${total.toFixed(2)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 24, borderTop: '1px solid #ccc', paddingTop: 12 }}>
          <Text>Autorizado por: ________________________  Fecha: ___________</Text>
          <Text style={{ marginTop: 4 }}>Supervisor: {params.supervisorName}</Text>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}
```

- [ ] **Step 2: Create Schedule of Accounts PDF generator**

*(Identical to v1 Task 11 Step 2 — follow `2026-06-02-jaf-foundation-quickwin.md`.)*

- [ ] **Step 3: Create Lissette's LC route with IVU from system_settings**

Create `app/routes/_app.docs.$id_.lc.tsx`:

```tsx
import { Form, redirect } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { canTransition } from '~/lib/permissions.server'
import { generateActaConformidadPdf } from '~/lib/pdf/acta-conformidad.server'
import { generateScheduleAccountsPdf } from '~/lib/pdf/schedule-accounts.server'
import { MaterialLineItems } from '~/components/material-line-items'
import { Button } from '~/components/ui/button'
import type { Route } from './+types/_app.docs.$id_.lc'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['FINANCE', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'LC_GENERATED', user.role)) throw redirect(`/docs/${params.id}`)
  const serviceCodes = await db.serviceCode.findMany()
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
  const ivuSetting = await db.systemSetting.findUnique({ where: { key: 'ivu_rate' } })
  const ivuRate = parseFloat(ivuSetting?.value ?? '0.115')
  return { doc, user, serviceCodes, supervisor, poLinks, ivuRate }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['FINANCE', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'LC_GENERATED', user.role)) throw redirect(`/docs/${params.id}`)

  const form = await request.formData()
  const intent = form.get('intent') as string
  const serviceCodes = await db.serviceCode.findMany()
  const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
  const ivuSetting = await db.systemSetting.findUnique({ where: { key: 'ivu_rate' } })
  const ivuRate = parseFloat(ivuSetting?.value ?? '0.115')

  const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
  const lcDir = path.join(uploadDir, 'lc-requests')
  await fs.mkdir(lcDir, { recursive: true })

  const used = (doc.materialsUsed as { serviceCodeId: string; qty: number }[]) || []
  const lineItems = used.map((item) => {
    const code = codeMap[item.serviceCodeId]
    return {
      claroCode: code?.claroCode ?? '',
      name: code?.name ?? '',
      qty: item.qty,
      unit: code?.unit ?? 'SR',
      unitPrice: Number(code?.unitPrice ?? 0),
      accountCode: code?.accountCode,
    }
  })

  const today = new Date().toLocaleDateString('en-US')
  const invoiceNumber = `M${new Date().getFullYear()}-${doc.avisoNumber ?? doc.controlNumber}`

  if (intent === 'generate_acta') {
    const pdfBytes = await generateActaConformidadPdf({
      controlNumber: doc.controlNumber,
      avisoNumber: doc.avisoNumber,
      jobType: doc.jobType,
      jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
      invoiceNumber,
      invoiceDate: today,
      lineItems,
      supervisorName: supervisor?.name ?? '',
      ivuRate,
    })
    const localPath = path.join(lcDir, `${params.id}-acta.pdf`)
    await fs.writeFile(localPath, pdfBytes)
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${doc.controlNumber}-acta.pdf"`,
      },
    })
  }

  if (intent === 'generate_schedule') {
    const subtotal = lineItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)
    const amount = subtotal + subtotal * ivuRate

    const pdfBytes = await generateScheduleAccountsPdf({
      invoices: [{
        invoiceDate: today,
        invoiceNumber,
        debtor: 'PRT/CLARO',
        poNumber: poLinks[0]?.claroPONumber ?? '',
        amount,
      }],
    })

    const localPath = path.join(lcDir, `${params.id}-schedule.pdf`)
    await fs.writeFile(localPath, pdfBytes)

    await db.jafInvoice.update({
      where: { id: params.id },
      data: { status: 'LC_GENERATED', lcRequestPdfPath: localPath, lcGeneratedAt: new Date(), lcApprovedById: user.id },
    })

    await db.auditTrail.create({
      data: {
        docId: params.id, userId: user.id, action: 'STATUS_CHANGED',
        diffJson: { status: { before: 'CLARO_UPLOADED', after: 'LC_GENERATED' } },
      },
    })

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${doc.controlNumber}-schedule.pdf"`,
      },
    })
  }

  throw redirect(`/docs/${params.id}`)
}

export default function LcView({ loaderData }: Route.ComponentProps) {
  const { doc, serviceCodes, supervisor, poLinks, ivuRate } = loaderData
  const used = (doc.materialsUsed as any[]) || []
  const claroPdfUrl = doc.claroPdfPath ? `/files/claro-pdfs/${(doc as any).id}-claro.pdf` : null

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">LC Request — Lissette Review</h1>
      <p className="font-mono text-sm text-slate-500">{(doc as any).controlNumber}</p>
      <p className="text-xs text-slate-400">IVU rate: {(ivuRate * 100).toFixed(1)}%</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2">JAF Invoice</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-slate-500">Job:</span> {(doc as any).jobType}</p>
            <p><span className="text-slate-500">Address:</span> {(doc as any).jobAddressActual ?? (doc as any).jobAddressEstimated}</p>
            <p><span className="text-slate-500">Aviso #:</span> {(doc as any).avisoNumber ?? '—'}</p>
            <p><span className="text-slate-500">Supervisor:</span> {(loaderData as any).supervisor?.name}</p>
          </div>
          <div className="mt-3">
            <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={used} readOnly />
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2">Claro Work Order PDF</h2>
          {claroPdfUrl ? (
            <iframe src={claroPdfUrl} className="w-full h-64 border rounded" title="Claro PDF" />
          ) : (
            <p className="text-sm text-slate-400">No Claro PDF on file.</p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Form method="post">
          <input type="hidden" name="intent" value="generate_acta" />
          <Button type="submit" variant="outline">Download Acta de Conformidad (2A)</Button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="generate_schedule" />
          <Button type="submit">Generate & Download Schedule of Accounts (2B)</Button>
        </Form>
      </div>
      <p className="text-xs text-slate-400">Generating the Schedule of Accounts marks this document LC_GENERATED. Email the PDF to hs@pbcc.com.</p>
    </div>
  )
}
```

- [ ] **Step 4: Create file serving route**

*(Identical to v1 Task 11 Step 4 — follow `2026-06-02-jaf-foundation-quickwin.md`.)*

- [ ] **Step 5: End-to-end smoke test**

Walk through the complete workflow:
1. supervisor → create doc → note control number
2. idalia → mark PREPPED
3. crew → dual sign → select warehouse → draw both signatures → submit → confirm SIGNED
4. crew → field update → correct address → update materials → upload photo → confirm FIELD_UPDATED
5. supervisor → review → confirm photos visible + Claro helper populated → approve → upload PDF → confirm CLARO_UPLOADED
6. lissette → LC view → generate Schedule of Accounts → PDF downloads → status LC_GENERATED

Also test the van bypass path:
1. supervisor → create doc
2. crew → go directly to `/docs/<id>/field` → confirm CREATED→FIELD_UPDATED transition works

- [ ] **Step 6: Commit**

```bash
git add app/routes/_app.docs.$id_.lc.tsx app/routes/files.$.tsx app/lib/pdf/
git commit -m "feat: LC route + Acta + Schedule PDFs — IVU from system_settings"
```

---

## Task 12: Notification Bell

*(Identical to v1 Task 12 — follow `2026-06-02-jaf-foundation-quickwin.md`, applying `db.jafInvoice` rename.)*

---

## Task 13: System Settings Admin UI

**Files:**
- Create: `app/routes/_app.admin.settings.tsx`

- [ ] **Step 1: Write failing test**

Create `app/lib/system-settings.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db.server', () => ({
  db: {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import { getIvuRate, setIvuRate } from './system-settings.server'
import { db } from './db.server'

describe('system settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getIvuRate returns parsed float from db', async () => {
    vi.mocked(db.systemSetting.findUnique).mockResolvedValue({ value: '0.115' } as any)
    const rate = await getIvuRate()
    expect(rate).toBe(0.115)
  })

  it('getIvuRate returns default 0.115 when setting missing', async () => {
    vi.mocked(db.systemSetting.findUnique).mockResolvedValue(null)
    const rate = await getIvuRate()
    expect(rate).toBe(0.115)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './system-settings.server'"

- [ ] **Step 3: Implement system-settings helper**

Create `app/lib/system-settings.server.ts`:

```ts
import { db } from './db.server'

export async function getIvuRate(): Promise<number> {
  const setting = await db.systemSetting.findUnique({ where: { key: 'ivu_rate' } })
  return parseFloat(setting?.value ?? '0.115')
}

export async function setIvuRate(rate: number, updatedById: string): Promise<void> {
  await db.systemSetting.upsert({
    where: { key: 'ivu_rate' },
    update: { value: String(rate), updatedById },
    create: { key: 'ivu_rate', value: String(rate), updatedById },
  })
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS — 2 tests pass

- [ ] **Step 5: Create admin settings route**

Create `app/routes/_app.admin.settings.tsx`:

```tsx
import { Form, useLoaderData } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { getIvuRate, setIvuRate } from '~/lib/system-settings.server'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import type { Route } from './+types/_app.admin.settings'

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ['ADMIN'])
  const ivuRate = await getIvuRate()
  return { ivuRate }
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['ADMIN'])
  const form = await request.formData()
  const rateRaw = form.get('ivu_rate') as string
  const rate = parseFloat(rateRaw)
  if (isNaN(rate) || rate <= 0 || rate >= 1) {
    return { error: 'IVU rate must be a decimal between 0 and 1 (e.g. 0.115 for 11.5%)' }
  }
  await setIvuRate(rate, user.id)
  return { success: true }
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { ivuRate } = loaderData
  return (
    <div className="space-y-6 max-w-sm">
      <h1 className="text-xl font-semibold">System Settings</h1>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-medium text-sm">IVU Tax Rate</h2>
        <p className="text-xs text-slate-500">
          Applied to all invoice PDF generation. Enter as decimal (e.g. 0.115 = 11.5%).
          Current: {(ivuRate * 100).toFixed(1)}%
        </p>
        <Form method="post" className="space-y-3">
          <div>
            <Label htmlFor="ivu_rate">IVU Rate (decimal)</Label>
            <Input
              id="ivu_rate"
              name="ivu_rate"
              type="number"
              step="0.001"
              min="0"
              max="0.999"
              defaultValue={ivuRate}
              required
            />
          </div>
          {(actionData as any)?.error && <p className="text-sm text-red-600">{(actionData as any).error}</p>}
          {(actionData as any)?.success && <p className="text-sm text-green-600">Saved.</p>}
          <Button type="submit" size="sm">Save</Button>
        </Form>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Test manually**

Log in as admin@jaf.com, navigate to `/admin/settings`. Change IVU rate to `0.105`, save. Generate an Acta de Conformidad PDF and confirm the IVU line shows 10.5%.

- [ ] **Step 7: Commit**

```bash
git add app/routes/_app.admin.settings.tsx app/lib/system-settings.server.ts app/lib/system-settings.server.test.ts
git commit -m "feat: system settings admin UI — configurable IVU rate"
```

---

## Task 14: LC/Receivables Aging Dashboard

**Files:**
- Create: `app/routes/_app.finance.receivables.tsx`

- [ ] **Step 1: Create receivables dashboard route**

Create `app/routes/_app.finance.receivables.tsx`:

```tsx
import { Form } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import type { Route } from './+types/_app.finance.receivables'

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ['FINANCE', 'ADMIN'])
  const invoices = await db.jafInvoice.findMany({
    where: { status: { in: ['LC_GENERATED', 'CLARO_UPLOADED', 'SUPERVISOR_APPROVED'] } },
    include: { supervisor: true, poLinks: true },
    orderBy: { lcGeneratedAt: 'desc' },
  })
  const now = Date.now()
  const rows = invoices.map((inv) => {
    const anchor = inv.lcGeneratedAt ?? inv.supervisorApprovedAt ?? inv.createdAt
    const ageDays = Math.floor((now - new Date(anchor).getTime()) / 86400000)
    return {
      id: inv.id,
      controlNumber: inv.controlNumber,
      avisoNumber: inv.avisoNumber,
      supervisorName: inv.supervisor?.name ?? '—',
      ageDays,
      status: inv.status,
      advanceReceivedAt: inv.advanceReceivedAt,
      advanceAmount: inv.advanceAmount ? Number(inv.advanceAmount) : null,
      finalPaymentReceivedAt: inv.finalPaymentReceivedAt,
      finalPaymentAmount: inv.finalPaymentAmount ? Number(inv.finalPaymentAmount) : null,
      receivableClosedAt: inv.receivableClosedAt,
    }
  })
  return { rows }
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['FINANCE', 'ADMIN'])
  const form = await request.formData()
  const intent = form.get('intent') as string
  const docId = form.get('docId') as string

  if (intent === 'record_advance') {
    const amount = parseFloat(form.get('advanceAmount') as string)
    if (isNaN(amount)) return { error: 'Invalid amount' }
    await db.jafInvoice.update({
      where: { id: docId },
      data: { advanceReceivedAt: new Date(), advanceAmount: amount },
    })
    await db.auditTrail.create({
      data: { docId, userId: user.id, action: 'ADVANCE_RECEIVED', diffJson: { advanceAmount: amount } },
    })
  }

  if (intent === 'record_final') {
    const amount = parseFloat(form.get('finalAmount') as string)
    if (isNaN(amount)) return { error: 'Invalid amount' }
    await db.jafInvoice.update({
      where: { id: docId },
      data: { finalPaymentReceivedAt: new Date(), finalPaymentAmount: amount },
    })
    await db.auditTrail.create({
      data: { docId, userId: user.id, action: 'FINAL_PAYMENT_RECEIVED', diffJson: { finalPaymentAmount: amount } },
    })
  }

  if (intent === 'close') {
    await db.jafInvoice.update({
      where: { id: docId },
      data: { receivableClosedAt: new Date(), receivableClosedById: user.id },
    })
    await db.auditTrail.create({
      data: { docId, userId: user.id, action: 'RECEIVABLE_CLOSED', diffJson: {} },
    })
  }

  return null
}

const AGE_COLOR = (days: number) =>
  days > 90 ? 'text-red-600 font-semibold'
  : days > 60 ? 'text-orange-600'
  : days > 30 ? 'text-yellow-700'
  : 'text-slate-700'

export default function ReceivablesDashboard({ loaderData, actionData }: Route.ComponentProps) {
  const { rows } = loaderData
  const open = rows.filter((r) => !r.receivableClosedAt)
  const closed = rows.filter((r) => r.receivableClosedAt)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Receivables</h1>
        <p className="text-sm text-slate-500">{open.length} open</p>
      </div>

      {(actionData as any)?.error && (
        <p className="text-sm text-red-600">{(actionData as any).error}</p>
      )}

      <div className="space-y-3">
        {open.map((row) => (
          <div key={row.id} className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono font-medium text-sm">{row.controlNumber}</span>
                {row.avisoNumber && <span className="text-xs text-slate-500 ml-2">Aviso {row.avisoNumber}</span>}
                <p className="text-xs text-slate-500">{row.supervisorName}</p>
              </div>
              <span className={`text-sm ${AGE_COLOR(row.ageDays)}`}>{row.ageDays}d</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              {/* Advance */}
              <div className="bg-slate-50 rounded p-2">
                <p className="text-slate-500 mb-1">80% Advance (PBCC)</p>
                {row.advanceReceivedAt ? (
                  <p className="text-green-700 font-medium">
                    ${row.advanceAmount?.toFixed(2)} — {new Date(row.advanceReceivedAt).toLocaleDateString()}
                  </p>
                ) : (
                  <Form method="post" className="flex gap-1 mt-1">
                    <input type="hidden" name="intent" value="record_advance" />
                    <input type="hidden" name="docId" value={row.id} />
                    <Input name="advanceAmount" type="number" step="0.01" placeholder="Amount" className="h-7 text-xs w-24" />
                    <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Record</Button>
                  </Form>
                )}
              </div>

              {/* Final payment */}
              <div className="bg-slate-50 rounded p-2">
                <p className="text-slate-500 mb-1">Final Payment (Claro)</p>
                {row.finalPaymentReceivedAt ? (
                  <p className="text-green-700 font-medium">
                    ${row.finalPaymentAmount?.toFixed(2)} — {new Date(row.finalPaymentReceivedAt).toLocaleDateString()}
                  </p>
                ) : (
                  <Form method="post" className="flex gap-1 mt-1">
                    <input type="hidden" name="intent" value="record_final" />
                    <input type="hidden" name="docId" value={row.id} />
                    <Input name="finalAmount" type="number" step="0.01" placeholder="Amount" className="h-7 text-xs w-24" />
                    <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Record</Button>
                  </Form>
                )}
              </div>

              {/* Close */}
              <div className="bg-slate-50 rounded p-2 flex flex-col justify-between">
                <p className="text-slate-500 mb-1">Close Entry</p>
                {row.advanceReceivedAt && row.finalPaymentReceivedAt ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="close" />
                    <input type="hidden" name="docId" value={row.id} />
                    <Button type="submit" size="sm" className="h-7 text-xs w-full">Close</Button>
                  </Form>
                ) : (
                  <p className="text-xs text-slate-400">Record both payments first</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Closed ({closed.length})</summary>
          <div className="mt-2 space-y-1">
            {closed.map((row) => (
              <div key={row.id} className="flex items-center justify-between text-xs text-slate-400 py-1 border-b">
                <span className="font-mono">{row.controlNumber}</span>
                <span>Closed {row.receivableClosedAt ? new Date(row.receivableClosedAt).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add receivables link to Finance dashboard**

In `app/routes/_app.dashboard.tsx`, add to the Finance role section:

```tsx
{user.role === 'FINANCE' && (
  <Button asChild variant="outline" size="sm">
    <Link to="/finance/receivables">Receivables</Link>
  </Button>
)}
```

- [ ] **Step 3: Test manually**

1. Complete a full workflow through LC_GENERATED
2. Log in as lissette@jaf.com, go to `/finance/receivables`
3. Confirm the entry shows with age in days
4. Record advance amount → confirm it saves and shows green
5. Record final payment → confirm close button appears
6. Close entry → confirm it moves to closed section

- [ ] **Step 4: Commit**

```bash
git add app/routes/_app.finance.receivables.tsx app/routes/_app.dashboard.tsx
git commit -m "feat: receivables aging dashboard — advance/final payment tracking + close entries"
```

---

## Task 15: One-Click Audit Package PDF

**Files:**
- Create: `app/lib/pdf/audit-package.server.tsx`
- Create: `app/routes/_app.docs.$id_.audit-package.tsx`

- [ ] **Step 1: Create audit package PDF generator**

Create `app/lib/pdf/audit-package.server.tsx`:

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 9 },
  h1: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  h2: { fontSize: 10, fontWeight: 'bold', marginTop: 12, marginBottom: 4, borderBottom: '0.5px solid #ccc', paddingBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  label: { color: '#555' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f1f5f9', padding: 3, fontSize: 8 },
  tableRow: { flexDirection: 'row', padding: 3, borderBottom: '0.5px solid #e2e8f0', fontSize: 8 },
  c1: { flex: 2 }, c2: { flex: 3 }, c3: { flex: 1, textAlign: 'right' }, c4: { flex: 1, textAlign: 'right' },
  sigBox: { flex: 1 },
})

interface AuditDoc {
  controlNumber: string
  jobType: string
  jobAddressEstimated: string
  jobAddressActual?: string | null
  avisoNumber?: string | null
  createdAt: Date
  signedAt?: Date | null
  supervisorApprovedAt?: Date | null
  lcGeneratedAt?: Date | null
  releaseSignature?: string | null
  crewSignature?: string | null
  warehouseName?: string | null
  materialsTaken: { serviceCodeId: string; qty: number }[]
  materialsUsed: { serviceCodeId: string; qty: number }[]
  auditTrail: { action: string; timestamp: Date; user: { name: string } }[]
  photos: { localPath: string }[]
}

interface ServiceCodeMap {
  [id: string]: { claroCode: string; name: string; unit: string }
}

export async function generateAuditPackagePdf(doc: AuditDoc, codeMap: ServiceCodeMap): Promise<Buffer> {
  const taken = doc.materialsTaken ?? []
  const used = doc.materialsUsed ?? []
  const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))

  const element = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <Text style={styles.h1}>Audit Package — {doc.controlNumber}</Text>
        <Text style={{ color: '#555', marginBottom: 10, fontSize: 8 }}>JAF Communications, Inc. — Generated for Claro audit purposes</Text>

        <View style={styles.row}>
          <Text><Text style={styles.label}>Job Type: </Text>{doc.jobType}</Text>
          <Text><Text style={styles.label}>Created: </Text>{new Date(doc.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.row}>
          <Text><Text style={styles.label}>Address (estimated): </Text>{doc.jobAddressEstimated}</Text>
        </View>
        {doc.jobAddressActual && (
          <View style={styles.row}>
            <Text><Text style={styles.label}>Address (actual): </Text>{doc.jobAddressActual}</Text>
          </View>
        )}
        {doc.avisoNumber && (
          <View style={styles.row}>
            <Text><Text style={styles.label}>Aviso #: </Text>{doc.avisoNumber}</Text>
          </View>
        )}
        {doc.warehouseName && (
          <View style={styles.row}>
            <Text><Text style={styles.label}>Warehouse: </Text>{doc.warehouseName}</Text>
          </View>
        )}

        {/* Materials issued vs used */}
        <Text style={styles.h2}>Materials — Issued vs Used</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.c1}>Code</Text>
          <Text style={styles.c2}>Description</Text>
          <Text style={styles.c3}>Issued</Text>
          <Text style={styles.c4}>Used</Text>
        </View>
        {taken.map((t, i) => {
          const code = codeMap[t.serviceCodeId]
          const usedQty = usedMap[t.serviceCodeId] ?? 0
          const leftOver = t.qty - usedQty
          return (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.c1}>{code?.claroCode ?? '—'}</Text>
              <Text style={styles.c2}>{code?.name ?? '—'}</Text>
              <Text style={styles.c3}>{t.qty} {code?.unit}</Text>
              <Text style={[styles.c4, leftOver > 0 ? { color: '#d97706' } : {}]}>{usedQty} {code?.unit}</Text>
            </View>
          )
        })}
        {taken.length === 0 && (
          <Text style={{ fontSize: 8, color: '#94a3b8', padding: 4 }}>No warehouse materials — crew used van stock.</Text>
        )}

        {/* Signatures */}
        {(doc.releaseSignature || doc.crewSignature) && (
          <>
            <Text style={styles.h2}>Signatures at Warehouse</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={styles.sigBox}>
                <Text style={{ fontSize: 8, color: '#555', marginBottom: 2 }}>Warehouse Release:</Text>
                {doc.releaseSignature && (
                  <Image src={doc.releaseSignature} style={{ height: 40, width: 160 }} />
                )}
                <Text style={{ fontSize: 7, color: '#aaa' }}>{doc.warehouseName}</Text>
              </View>
              <View style={styles.sigBox}>
                <Text style={{ fontSize: 8, color: '#555', marginBottom: 2 }}>Crew Receipt:</Text>
                {doc.crewSignature && (
                  <Image src={doc.crewSignature} style={{ height: 40, width: 160 }} />
                )}
                <Text style={{ fontSize: 7, color: '#aaa' }}>
                  {doc.signedAt ? new Date(doc.signedAt).toLocaleString() : ''}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Photos count */}
        {doc.photos.length > 0 && (
          <>
            <Text style={styles.h2}>Field Photos</Text>
            <Text style={{ fontSize: 8, color: '#555' }}>
              {doc.photos.length} photo(s) attached to this job record. Stored on-premise server.
            </Text>
          </>
        )}

        {/* Audit trail */}
        <Text style={styles.h2}>Audit Trail</Text>
        {doc.auditTrail.map((entry, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 2, fontSize: 8 }}>
            <Text style={{ color: '#555', width: 100 }}>{new Date(entry.timestamp).toLocaleString()}</Text>
            <Text style={{ width: 100 }}>{entry.user.name}</Text>
            <Text style={{ color: '#333' }}>{entry.action}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}
```

- [ ] **Step 2: Create audit package route**

Create `app/routes/_app.docs.$id_.audit-package.tsx`:

```tsx
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { generateAuditPackagePdf } from '~/lib/pdf/audit-package.server'
import type { Route } from './+types/_app.docs.$id_.audit-package'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireRole(request, ['SUPERVISOR', 'FINANCE', 'ADMIN'])
  const doc = await db.jafInvoice.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      photos: true,
      auditTrail: { include: { user: true }, orderBy: { timestamp: 'asc' } },
      warehouse: true,
    },
  })
  const serviceCodes = await db.serviceCode.findMany()
  const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, { claroCode: c.claroCode, name: c.name, unit: c.unit }]))

  const pdfBytes = await generateAuditPackagePdf(
    {
      controlNumber: doc.controlNumber,
      jobType: doc.jobType,
      jobAddressEstimated: doc.jobAddressEstimated,
      jobAddressActual: doc.jobAddressActual,
      avisoNumber: doc.avisoNumber,
      createdAt: doc.createdAt,
      signedAt: doc.signedAt,
      supervisorApprovedAt: doc.supervisorApprovedAt,
      lcGeneratedAt: doc.lcGeneratedAt,
      releaseSignature: doc.releaseSignature,
      crewSignature: doc.crewSignature,
      warehouseName: doc.warehouse?.name ?? null,
      materialsTaken: (doc.materialsTaken as any[]) ?? [],
      materialsUsed: (doc.materialsUsed as any[]) ?? [],
      auditTrail: doc.auditTrail as any,
      photos: doc.photos,
    },
    codeMap
  )

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.controlNumber}-audit.pdf"`,
    },
  })
}
```

- [ ] **Step 3: Add audit package button to doc view**

In `app/routes/_app.docs.$id.tsx`, add after the Next Action button:

```tsx
{(user.role === 'SUPERVISOR' || user.role === 'FINANCE' || user.role === 'ADMIN') && (
  <a
    href={`/docs/${(doc as any).id}/audit-package`}
    className="block text-center text-sm text-slate-500 hover:text-slate-700 underline mt-2"
    target="_blank"
    rel="noreferrer"
  >
    Download Audit Package
  </a>
)}
```

- [ ] **Step 4: Test manually**

1. Complete a doc through LC_GENERATED with warehouse pickup + photos
2. Log in as supervisor or admin, go to `/docs/<id>`
3. Click "Download Audit Package"
4. Verify PDF contains: materials issued vs used table, both signatures, photo count, full audit trail

- [ ] **Step 5: Commit**

```bash
git add app/lib/pdf/audit-package.server.tsx app/routes/_app.docs.$id_.audit-package.tsx app/routes/_app.docs.$id.tsx
git commit -m "feat: one-click audit package PDF — issued vs used, signatures, photos, audit trail"
```

---

## Self-Review Checklist

| Spec requirement | Covered in task |
|---|---|
| Entity: JAF Invoice (jaf_invoice) | Task 2 |
| 3 zone warehouses | Task 2 (seed), Task 8 (selection) |
| SystemSetting (IVU rate) | Task 2 (schema + seed), Task 13 |
| Dual signature at warehouse pickup | Task 8 |
| warehouseId set at signing, not prep | Task 2 (schema comment), Task 8 |
| CREATED → FIELD_UPDATED van bypass | Task 3 (permissions), Task 9 |
| Override fields on JafInvoice | Task 2 (schema) |
| Override fields on VanRestockRequest | Task 2 (schema) |
| Payment tracking fields on JafInvoice | Task 2 (schema) |
| Photos inline in supervisor review | Task 10 |
| Claro submission helper | Task 10 |
| IVU single rate from system_settings | Task 11, Task 13 |
| LC/Receivables aging dashboard | Task 14 |
| One-click audit package PDF | Task 15 |
| Consignment ledger tables defined | Task 2 (VanRestockRequest, ConsignmentReceipt) |
| Audit trail before = doc.status (dynamic) | Task 9 note |
| Control number engine | Task 4 (db.jafInvoice) |
| 5 RBAC roles | Task 3 |
| Warehouse receipt with both signatures | Task 8 |
| FIELD_UPDATED audit trail dynamic before | Task 9 |

**Deferred to Plan 2 (Weeks 5–6):**
- Van Restock Request routes/UI
- Consignment Ledger UI + admin entry
- Full IndexedDB offline queue (Background Sync)
- 2FA for Finance + Admin roles
- Production Journal PDF (Doc 3)
- Final Invoice for Claro Portal (Doc 5)

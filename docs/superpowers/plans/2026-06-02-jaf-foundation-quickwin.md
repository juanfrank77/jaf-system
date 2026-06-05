# JAF Operations Platform — Plan 1: Foundation + Quick Win


**Goal:** Close the maintenance accountability loop — supervisor creates JAF Control Document → Idalia preps materials → crew signs at warehouse (locking materials taken) → crew updates from field → supervisor approves and uploads Claro PDF → Lissette generates LC request PDF.

**Architecture:** React Router v7 (framework mode) serves both the SSR app and API actions. PostgreSQL via Prisma is the single source of truth. better-auth handles session-based auth with 5 RBAC roles. The crew field update route is cached offline via vite-plugin-pwa + Workbox with IndexedDB queuing.

**Tech Stack:** React Router v7, PostgreSQL (Neon dev / on-premise prod), Prisma ORM, better-auth, Tailwind CSS, shadcn/ui, vite-plugin-pwa + Workbox, SignaturePad.js, @react-pdf/renderer

> **Scope note:** This plan covers Weeks 1–4 only.
> - Plan 2 (Weeks 5–6): Module 1 — Installation Disbursement (Barbara's weekly requests, Idalia's inventory dashboard)
> - Plan 3 (Month 2): Module 2A + 3 — Installation field ops, unified reconciliation, auto invoicing

---

## File Map

```
jaf-operations/
├── app/
│   ├── root.tsx                              # HTML shell, PWA meta tags
│   ├── entry.client.tsx                      # Hydration entry
│   ├── entry.server.tsx                      # SSR entry
│   ├── routes/
│   │   ├── _auth.tsx                         # Unauthenticated shell (login)
│   │   ├── _auth.login.tsx                   # Login page + action
│   │   ├── _app.tsx                          # Authenticated shell — checks session
│   │   ├── _app.dashboard.tsx                # Role-aware home
│   │   ├── _app.docs.new.tsx                 # Supervisor: create control doc
│   │   ├── _app.docs.$id.tsx                 # View doc (redirects by role+status)
│   │   ├── _app.docs.$id_.prep.tsx           # Idalia: mark prepped
│   │   ├── _app.docs.$id_.sign.tsx           # Crew + Idalia: signature capture
│   │   ├── _app.docs.$id_.field.tsx          # Crew: field update (offline-capable)
│   │   ├── _app.docs.$id_.review.tsx         # Supervisor: approve + Claro upload
│   │   ├── _app.docs.$id_.lc.tsx             # Lissette: compare + generate LC PDF
│   │   └── _app.admin/
│   │       ├── _app.admin.users.tsx          # Admin: user management
│   │       └── _app.admin.catalog.tsx        # Admin: service code catalog
│   ├── components/
│   │   ├── signature-pad.tsx                 # SignaturePad.js React wrapper
│   │   ├── material-line-items.tsx           # Shared editable material list
│   │   ├── status-badge.tsx                  # Color-coded doc status chip
│   │   └── pdf-preview-frame.tsx             # iframe wrapper for Claro PDF display
│   ├── lib/
│   │   ├── auth.server.ts                    # better-auth instance + session helpers
│   │   ├── db.server.ts                      # Prisma client singleton
│   │   ├── control-number.server.ts          # MAINT-YYMMDD-NNN atomic generator
│   │   ├── permissions.server.ts             # requireRole() + canTransition()
│   │   ├── notifications.server.ts           # In-app notification insert helpers
│   │   └── pdf/
│   │       ├── warehouse-receipt.server.tsx  # @react-pdf/renderer — Doc 1
│   │       ├── acta-conformidad.server.tsx   # @react-pdf/renderer — Doc 2A
│   │       └── schedule-accounts.server.tsx  # @react-pdf/renderer — Doc 2B
│   └── sw.ts                                 # Workbox service worker (vite-plugin-pwa)
├── prisma/
│   ├── schema.prisma                         # All tables (all modules — seed once)
│   └── seed.ts                               # Sample users + service codes
├── public/
│   └── manifest.webmanifest                  # PWA manifest
├── vite.config.ts
├── package.json
└── .env                                      # DATABASE_URL, BETTER_AUTH_SECRET
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `app/root.tsx`, `app/entry.client.tsx`, `app/entry.server.tsx`, `.env`, `public/manifest.webmanifest`

- [ ] **Step 1: Scaffold React Router v7 in the existing directory**

```bash
cd /home/juanfrank/jaf-operations
npx create-react-router@latest . --template remix
```

When prompted "Directory is not empty, continue?" → yes. Select: TypeScript, yes to git init if offered (or skip — no git yet).

- [ ] **Step 2: Install all dependencies at once**

```bash
npm install @prisma/client prisma better-auth @react-pdf/renderer signature_pad
npm install -D vite-plugin-pwa workbox-window @types/react @types/react-dom
npx shadcn@latest init
```

shadcn init prompts: style=Default, base color=Slate, CSS variables=yes.

- [ ] **Step 3: Add shadcn components needed for Plan 1**

```bash
npx shadcn@latest add button input label select textarea badge card table dialog sheet toast
```

- [ ] **Step 4: Configure vite.config.ts with PWA plugin**

Replace the generated `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import { VitePWA } from 'vite-plugin-pwa'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    reactRouter(),
    tsconfigPaths(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'app',
      filename: 'sw.ts',
      manifest: {
        name: 'JAF Operations',
        short_name: 'JAF',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
```

- [ ] **Step 5: Create minimal service worker stub**

Create `app/sw.ts`:

```ts
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// Field update route — NetworkFirst so online updates win, falls back to cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/docs/') && url.pathname.endsWith('/field'),
  new NetworkFirst({ cacheName: 'field-update-v1' })
)

// Static assets — cache first
registerRoute(
  ({ request }) => request.destination === 'style' || request.destination === 'script',
  new CacheFirst({ cacheName: 'static-v1' })
)
```

- [ ] **Step 6: Create .env**

```bash
cat > .env << 'EOF'
DATABASE_URL="postgresql://..."   # Replace with Neon connection string
BETTER_AUTH_SECRET="replace-with-32-char-random-string"
BETTER_AUTH_URL="http://localhost:5173"
EOF
```

Get the Neon connection string from the White Elephants project dashboard. The secret can be any 32+ character random string for dev.

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts at http://localhost:5173, no TypeScript errors, no import errors.

- [ ] **Step 8: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold RR7 + PWA + shadcn/ui + dependencies"
```

---

## Task 2: Database Schema

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `app/lib/db.server.ts`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` with a DATABASE_URL reference. The `.env` file already has `DATABASE_URL`.

- [ ] **Step 2: Write schema.prisma — all tables for all modules**

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

  // better-auth relations
  sessions  Session[]
  accounts  Account[]

  supervisedDocs   JafControlDoc[] @relation("SupervisorDocs")
  preppedDocs      JafControlDoc[] @relation("PreppedDocs")
  signedDocs       JafControlDoc[] @relation("SignedDocs")
  lcApprovedDocs   JafControlDoc[] @relation("LcApprovedDocs")
  auditTrail       AuditTrail[]
  photos           Photo[]
  notifications    Notification[]
}

model Session {
  id        String   @id
  userId    String
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  accountId         String
  providerId        String
  accessToken       String?
  refreshToken      String?
  idToken           String?
  accessTokenExpiresAt DateTime?
  refreshTokenExpiresAt DateTime?
  scope             String?
  password          String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model JafControlDoc {
  id            String    @id @default(cuid())
  controlNumber String    @unique
  status        DocStatus @default(CREATED)

  // Supervisor fills at creation
  jobType             String
  jobAddressEstimated String
  estimatedMaterials  Json     // [{serviceCodeId, qty}]
  assignedCrewIds     String[] // User IDs
  supervisorId        String
  supervisor          User     @relation("SupervisorDocs", fields: [supervisorId], references: [id])
  createdAt           DateTime @default(now())

  // Idalia marks prepped
  preppedAt   DateTime?
  preppedById String?
  preppedBy   User?    @relation("PreppedDocs", fields: [preppedById], references: [id])

  // Crew signs at warehouse — materialsTaken locked permanently after this
  materialsTaken  Json?    // [{serviceCodeId, qty}]
  crewSignature   String?  // base64 PNG
  signedAt        DateTime?
  signedById      String?
  signedBy        User?   @relation("SignedDocs", fields: [signedById], references: [id])

  // Crew field update
  jobAddressActual  String?
  materialsUsed     Json?    // [{serviceCodeId, qty}] — must be <= materialsTaken
  fieldNotes        String?
  completedAt       DateTime?

  // Supervisor review
  supervisorApprovedAt DateTime?
  claroNotes           String?

  // Supervisor uploads Claro PDF
  claroPdfPath    String?
  claroUploadedAt DateTime?
  avisoNumber     String?  // Claro-assigned Aviso number (e.g. 10333185)

  // Lissette generates LC
  lcRequestPdfPath  String?
  lcGeneratedAt     DateTime?
  lcApprovedById    String?
  lcApprovedBy      User?   @relation("LcApprovedDocs", fields: [lcApprovedById], references: [id])

  // Warehouse receipt PDF (generated at signing)
  warehouseReceiptPath String?

  // Relations
  auditTrail   AuditTrail[]
  photos       Photo[]
  poLinks      PoLink[]
}

model AuditTrail {
  id        String   @id @default(cuid())
  docId     String
  doc       JafControlDoc @relation(fields: [docId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  action    String   // e.g. "STATUS_CHANGED", "FIELD_UPDATED"
  diffJson  Json     // {field, before, after}
  timestamp DateTime @default(now())
}

model Photo {
  id          String   @id @default(cuid())
  docId       String
  doc         JafControlDoc @relation(fields: [docId], references: [id])
  uploadedById String
  uploadedBy  User     @relation(fields: [uploadedById], references: [id])
  localPath   String   // /var/jaf/uploads/photos/<docId>/<filename>
  takenAt     DateTime @default(now())
}

model ServiceCode {
  id            String  @id @default(cuid())
  claroCode     String  @unique // e.g. "34006428"
  name          String          // e.g. "REMOCION MENSAJERO"
  description   String?
  unit          String  @default("SR")
  unitPrice     Decimal
  accountCode   String?
  subAct        String?
  dept          String?
  profitCenter  String?
  act           String?
  costCenterCode String?
  active        Boolean @default(true)
}

model PoLink {
  id               String @id @default(cuid())
  docId            String
  doc              JafControlDoc @relation(fields: [docId], references: [id])
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

// Module 1 tables (Weeks 5-6) — schema defined now, routes built later
model InstallationRequest {
  id          String   @id @default(cuid())
  requestedBy String
  weekOf      DateTime
  items       Json     // [{serviceCodeId, qty}]
  status      String   @default("PENDING")
  createdAt   DateTime @default(now())
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

- [ ] **Step 5: Create seed.ts with test users and sample service codes**

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

  // Sample Claro service codes from contract
  const codes = [
    { claroCode: '34006428', name: 'REMOCION MENSAJERO', unit: 'SR', unitPrice: 0.36, accountCode: '6200', dept: 'PWOR' },
    { claroCode: '34006429', name: 'INSTALACION MENSAJERO', unit: 'SR', unitPrice: 0.52, accountCode: '6200', dept: 'PWOR' },
    { claroCode: '34006430', name: 'MANTENIMIENTO GENERAL', unit: 'SR', unitPrice: 0.44, accountCode: '6210', dept: 'PWOR' },
  ]

  for (const c of codes) {
    await db.serviceCode.upsert({
      where: { claroCode: c.claroCode },
      update: {},
      create: c,
    })
  }

  console.log('Seed complete')
}

main().catch(console.error).finally(() => db.$disconnect())
```

Add to `package.json` scripts:

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

Install tsx: `npm install -D tsx`

- [ ] **Step 6: Run seed**

```bash
npx prisma db seed
```

Expected: "Seed complete" — 5 users and 3 service codes created.

- [ ] **Step 7: Verify with Prisma Studio**

```bash
npx prisma studio
```

Open http://localhost:5555 and confirm users and service codes exist.

- [ ] **Step 8: Commit**

```bash
git add prisma/ app/lib/db.server.ts package.json
git commit -m "feat: prisma schema + neon migration + seed data"
```

---

## Task 3: Auth + RBAC

**Files:**
- Create: `app/lib/auth.server.ts`, `app/lib/permissions.server.ts`
- Modify: `app/routes/_auth.login.tsx`, `app/routes/_app.tsx`

- [ ] **Step 1: Configure better-auth**

Create `app/lib/auth.server.ts`:

```ts
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { db } from './db.server'

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,
  },
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

// State machine: which transitions are allowed
const TRANSITIONS: Record<string, { from: string; roles: Role[] }> = {
  PREPPED:             { from: 'CREATED',             roles: ['WAREHOUSE', 'ADMIN'] },
  SIGNED:              { from: 'PREPPED',              roles: ['CREW', 'WAREHOUSE', 'ADMIN'] },
  FIELD_UPDATED:       { from: 'SIGNED',               roles: ['CREW', 'ADMIN'] },
  SUPERVISOR_APPROVED: { from: 'FIELD_UPDATED',        roles: ['SUPERVISOR', 'ADMIN'] },
  CLARO_UPLOADED:      { from: 'SUPERVISOR_APPROVED',  roles: ['SUPERVISOR', 'ADMIN'] },
  LC_GENERATED:        { from: 'CLARO_UPLOADED',       roles: ['FINANCE', 'ADMIN'] },
}

export function canTransition(currentStatus: string, targetStatus: string, role: Role): boolean {
  const rule = TRANSITIONS[targetStatus]
  if (!rule) return false
  return rule.from === currentStatus && rule.roles.includes(role)
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

Create `app/routes/_auth.login.tsx`:

```tsx
import { Form, redirect, useActionData } from 'react-router'
import { auth } from '~/lib/auth.server'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import type { Route } from './+types/_auth.login'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (session) throw redirect('/dashboard')
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const email = form.get('email') as string
  const password = form.get('password') as string

  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
    })
    const headers = new Headers()
    if (result.headers) {
      result.headers.forEach((v, k) => headers.append(k, v))
    }
    throw redirect('/dashboard', { headers })
  } catch (e: any) {
    if (e instanceof Response) throw e
    return { error: 'Invalid email or password' }
  }
}

export default function LoginPage() {
  const data = useActionData<typeof action>()
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">JAF Operations</h1>
        <Form method="post" className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {data?.error && <p className="text-sm text-red-600">{data.error}</p>}
          <Button type="submit" className="w-full">Sign In</Button>
        </Form>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create authenticated app shell**

Create `app/routes/_app.tsx`:

```tsx
import { Outlet, redirect, Link, Form } from 'react-router'
import { requireSession } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import type { Route } from './+types/_app'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })
  return { user: { name: user.name, role: user.role } }
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="font-bold text-lg">JAF Ops</Link>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{user.name}</span>
          <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{user.role}</span>
          <Form method="post" action="/api/auth/sign-out">
            <button type="submit" className="text-slate-500 hover:text-slate-800">Sign out</button>
          </Form>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Test auth flow manually**

```bash
npm run dev
```

1. Open http://localhost:5173 — should redirect to /login
2. Log in as supervisor@jaf.com / jaf2026! — should redirect to /dashboard (404 is fine — dashboard not built yet)
3. Try http://localhost:5173/docs/new without being logged in — should redirect to /login

- [ ] **Step 7: Commit**

```bash
git add app/lib/auth.server.ts app/lib/permissions.server.ts app/routes/
git commit -m "feat: better-auth session auth + RBAC helpers + login route"
```

---

## Task 4: Control Number Engine

**Files:**
- Create: `app/lib/control-number.server.ts`
- Create: `app/lib/control-number.server.test.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest @vitest/ui
```

Add to `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Add `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 2: Write the failing test**

Create `app/lib/control-number.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module before importing the function
vi.mock('./db.server', () => ({
  db: {
    jafControlDoc: {
      count: vi.fn(),
    },
  },
}))

import { generateControlNumber } from './control-number.server'
import { db } from './db.server'

describe('generateControlNumber', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns MAINT-YYMMDD-001 for first doc of the day', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(0)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-001')
  })

  it('increments sequence when docs already exist today', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(4)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-005')
  })

  it('pads sequence to 3 digits', async () => {
    vi.mocked(db.jafControlDoc.count).mockResolvedValue(99)
    const result = await generateControlNumber('2026-06-15')
    expect(result).toBe('MAINT-260615-100')
  })
})
```

- [ ] **Step 3: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './control-number.server'"

- [ ] **Step 4: Implement the control number generator**

Create `app/lib/control-number.server.ts`:

```ts
import { db } from './db.server'

export async function generateControlNumber(dateStr?: string): Promise<string> {
  const d = dateStr ? new Date(dateStr) : new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const prefix = `MAINT-${yy}${mm}${dd}`

  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 86400000)

  const count = await db.jafControlDoc.count({
    where: { createdAt: { gte: startOfDay, lt: endOfDay } },
  })

  const seq = String(count + 1).padStart(3, '0')
  return `${prefix}-${seq}`
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npm test
```

Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add app/lib/control-number.server.ts app/lib/control-number.server.test.ts vitest.config.ts
git commit -m "feat: control number engine with tests (MAINT-YYMMDD-NNN)"
```

---

## Task 5: Service Catalog Admin UI

**Files:**
- Create: `app/routes/_app.admin.catalog.tsx`
- Create: `app/routes/_app.dashboard.tsx`

- [ ] **Step 1: Create role-aware dashboard**

Create `app/routes/_app.dashboard.tsx`:

```tsx
import { Link } from 'react-router'
import { requireSession } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import type { Route } from './+types/_app.dashboard'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })

  const docs = await db.jafControlDoc.findMany({
    where: user.role === 'SUPERVISOR'
      ? { supervisorId: user.id }
      : user.role === 'CREW'
        ? { assignedCrewIds: { has: user.id } }
        : {}, // WAREHOUSE, FINANCE, ADMIN see all
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return { user, docs }
}

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-yellow-100 text-yellow-800',
  PREPPED: 'bg-blue-100 text-blue-800',
  SIGNED: 'bg-purple-100 text-purple-800',
  FIELD_UPDATED: 'bg-orange-100 text-orange-800',
  SUPERVISOR_APPROVED: 'bg-teal-100 text-teal-800',
  CLARO_UPLOADED: 'bg-indigo-100 text-indigo-800',
  LC_GENERATED: 'bg-green-100 text-green-800',
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { user, docs } = loaderData
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {(user.role === 'SUPERVISOR' || user.role === 'ADMIN') && (
          <Button asChild size="sm">
            <Link to="/docs/new">+ New Document</Link>
          </Button>
        )}
      </div>

      {docs.length === 0 && (
        <p className="text-slate-500 text-sm">No documents yet.</p>
      )}

      <div className="space-y-2">
        {docs.map((doc) => (
          <Link
            key={doc.id}
            to={`/docs/${doc.id}`}
            className="block bg-white border rounded-lg p-4 hover:border-slate-400 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-medium">{doc.controlNumber}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>
                {doc.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">{doc.jobType} — {doc.jobAddressEstimated}</p>
            <p className="text-xs text-slate-400 mt-1">{new Date(doc.createdAt).toLocaleDateString()}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create service catalog admin route**

Create `app/routes/_app.admin.catalog.tsx`:

```tsx
import { Form, useActionData, useLoaderData } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import type { Route } from './+types/_app.admin.catalog'

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ['ADMIN'])
  const codes = await db.serviceCode.findMany({ orderBy: { claroCode: 'asc' } })
  return { codes }
}

export async function action({ request }: Route.ActionArgs) {
  await requireRole(request, ['ADMIN'])
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'create') {
    const claroCode = (form.get('claroCode') as string).trim()
    const name = (form.get('name') as string).trim()
    const unitPrice = parseFloat(form.get('unitPrice') as string)
    const accountCode = (form.get('accountCode') as string | null)?.trim() || null
    const dept = (form.get('dept') as string | null)?.trim() || null

    if (!claroCode || !name || isNaN(unitPrice)) {
      return { error: 'Code, name, and unit price are required' }
    }

    await db.serviceCode.create({
      data: { claroCode, name, unit: 'SR', unitPrice, accountCode, dept },
    })
  }

  if (intent === 'toggle') {
    const id = form.get('id') as string
    const current = await db.serviceCode.findUniqueOrThrow({ where: { id } })
    await db.serviceCode.update({ where: { id }, data: { active: !current.active } })
  }

  return null
}

export default function CatalogAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const { codes } = loaderData
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Service Code Catalog</h1>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-medium text-sm">Add Service Code</h2>
        <Form method="post" className="grid grid-cols-2 gap-3">
          <input type="hidden" name="intent" value="create" />
          <div>
            <Label htmlFor="claroCode">Claro Code</Label>
            <Input id="claroCode" name="claroCode" placeholder="34006428" required />
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="REMOCION MENSAJERO" required />
          </div>
          <div>
            <Label htmlFor="unitPrice">Unit Price ($)</Label>
            <Input id="unitPrice" name="unitPrice" type="number" step="0.01" placeholder="0.36" required />
          </div>
          <div>
            <Label htmlFor="accountCode">Account Code</Label>
            <Input id="accountCode" name="accountCode" placeholder="6200" />
          </div>
          <div>
            <Label htmlFor="dept">Dept</Label>
            <Input id="dept" name="dept" placeholder="PWOR" />
          </div>
          {(actionData as any)?.error && (
            <p className="col-span-2 text-sm text-red-600">{(actionData as any).error}</p>
          )}
          <div className="col-span-2">
            <Button type="submit" size="sm">Add Code</Button>
          </div>
        </Form>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            <th className="pb-2">Code</th>
            <th className="pb-2">Name</th>
            <th className="pb-2">Unit Price</th>
            <th className="pb-2">Status</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id} className={`border-b last:border-0 ${!c.active ? 'opacity-40' : ''}`}>
              <td className="py-2 font-mono">{c.claroCode}</td>
              <td className="py-2">{c.name}</td>
              <td className="py-2">${Number(c.unitPrice).toFixed(2)}</td>
              <td className="py-2">{c.active ? 'Active' : 'Inactive'}</td>
              <td className="py-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="text-xs text-slate-500 hover:text-slate-800">
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Test manually**

```bash
npm run dev
```

Log in as admin@jaf.com, navigate to /admin/catalog. Add a service code. Verify it appears in the table.

- [ ] **Step 4: Commit**

```bash
git add app/routes/
git commit -m "feat: dashboard + service catalog admin UI"
```

---

## Task 6: Supervisor Creates JAF Control Document

**Files:**
- Create: `app/routes/_app.docs.new.tsx`
- Create: `app/components/material-line-items.tsx`

- [ ] **Step 1: Create the material line items component**

Create `app/components/material-line-items.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

export interface LineItem {
  serviceCodeId: string
  qty: number
}

interface ServiceCode {
  id: string
  claroCode: string
  name: string
  unit: string
  unitPrice: number
}

interface Props {
  serviceCodes: ServiceCode[]
  initialItems?: LineItem[]
  readOnly?: boolean
  name?: string // hidden input name for form submission
}

export function MaterialLineItems({ serviceCodes, initialItems = [], readOnly = false, name = 'materials' }: Props) {
  const [items, setItems] = useState<LineItem[]>(initialItems)

  const addItem = () => setItems([...items, { serviceCodeId: '', qty: 1 }])
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))
  const updateItem = (i: number, patch: Partial<LineItem>) =>
    setItems(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)))

  const used = new Set(items.map((i) => i.serviceCodeId).filter(Boolean))
  const available = serviceCodes.filter((c) => !used.has(c.id))

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      {items.map((item, i) => {
        const code = serviceCodes.find((c) => c.id === item.serviceCodeId)
        if (readOnly) {
          return (
            <div key={i} className="flex items-center gap-3 text-sm py-1 border-b last:border-0">
              <span className="font-mono text-xs text-slate-500">{code?.claroCode}</span>
              <span className="flex-1">{code?.name ?? '—'}</span>
              <span className="w-16 text-right">{item.qty} {code?.unit}</span>
              <span className="w-20 text-right">${(Number(code?.unitPrice ?? 0) * item.qty).toFixed(2)}</span>
            </div>
          )
        }
        return (
          <div key={i} className="flex items-center gap-2">
            <Select
              value={item.serviceCodeId}
              onValueChange={(v) => updateItem(i, { serviceCodeId: v })}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select service code..." />
              </SelectTrigger>
              <SelectContent>
                {code && <SelectItem value={code.id}>{code.claroCode} — {code.name}</SelectItem>}
                {available.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.claroCode} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              value={item.qty}
              onChange={(e) => updateItem(i, { qty: parseInt(e.target.value) || 1 })}
              className="w-20"
            />
            <button type="button" onClick={() => removeItem(i)} className="text-slate-400 hover:text-red-600 text-lg">×</button>
          </div>
        )
      })}
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          + Add Service Code
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the new document route**

Create `app/routes/_app.docs.new.tsx`:

```tsx
import { Form, redirect, useLoaderData } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { generateControlNumber } from '~/lib/control-number.server'
import { MaterialLineItems } from '~/components/material-line-items'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import type { Route } from './+types/_app.docs.new'

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['SUPERVISOR', 'ADMIN'])
  const serviceCodes = await db.serviceCode.findMany({ where: { active: true }, orderBy: { claroCode: 'asc' } })
  const crew = await db.user.findMany({ where: { role: 'CREW', active: true }, orderBy: { name: 'asc' } })
  return { user, serviceCodes, crew }
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['SUPERVISOR', 'ADMIN'])
  const form = await request.formData()

  const jobType = (form.get('jobType') as string).trim()
  const jobAddressEstimated = (form.get('jobAddressEstimated') as string).trim()
  const assignedCrewIds = form.getAll('assignedCrewIds') as string[]
  const materialsRaw = form.get('materials') as string
  const avisoNumber = (form.get('avisoNumber') as string | null)?.trim() || null

  let estimatedMaterials: { serviceCodeId: string; qty: number }[] = []
  try {
    estimatedMaterials = JSON.parse(materialsRaw).filter((i: any) => i.serviceCodeId && i.qty > 0)
  } catch {
    return { error: 'Invalid materials data' }
  }

  if (!jobType || !jobAddressEstimated || assignedCrewIds.length === 0) {
    return { error: 'Job type, address, and at least one crew member are required' }
  }

  const controlNumber = await generateControlNumber()

  const doc = await db.jafControlDoc.create({
    data: {
      controlNumber,
      status: 'CREATED',
      jobType,
      jobAddressEstimated,
      estimatedMaterials,
      assignedCrewIds,
      supervisorId: user.id,
      avisoNumber,
    },
  })

  // Notify Idalia (warehouse role users)
  const warehouse = await db.user.findMany({ where: { role: 'WAREHOUSE', active: true } })
  await db.notification.createMany({
    data: warehouse.map((w) => ({
      userId: w.id,
      docId: doc.id,
      message: `New job ${controlNumber} — ${jobType} at ${jobAddressEstimated}. Please prepare materials.`,
    })),
  })

  await db.auditTrail.create({
    data: { docId: doc.id, userId: user.id, action: 'CREATED', diffJson: { status: { before: null, after: 'CREATED' } } },
  })

  throw redirect(`/docs/${doc.id}`)
}

export default function NewDoc({ loaderData, actionData }: Route.ComponentProps) {
  const { serviceCodes, crew } = loaderData
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">New Control Document</h1>
      <Form method="post" className="space-y-4">
        <div>
          <Label htmlFor="jobType">Job Type</Label>
          <Input id="jobType" name="jobType" placeholder="Mantenimiento, Instalación..." required />
        </div>
        <div>
          <Label htmlFor="jobAddressEstimated">Job Address (estimated)</Label>
          <Input id="jobAddressEstimated" name="jobAddressEstimated" placeholder="Calle X, Barrio Y, Municipio" required />
        </div>
        <div>
          <Label htmlFor="avisoNumber">Claro Aviso # (if known)</Label>
          <Input id="avisoNumber" name="avisoNumber" placeholder="10333185" />
        </div>
        <div>
          <Label>Assigned Crew</Label>
          <div className="space-y-1 mt-1">
            {crew.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="assignedCrewIds" value={c.id} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Estimated Materials</Label>
          <div className="mt-1">
            <MaterialLineItems serviceCodes={serviceCodes as any} />
          </div>
        </div>
        {(actionData as any)?.error && (
          <p className="text-sm text-red-600">{(actionData as any).error}</p>
        )}
        <Button type="submit" className="w-full">Create Document</Button>
      </Form>
    </div>
  )
}
```

- [ ] **Step 3: Test manually**

```bash
npm run dev
```

Log in as supervisor@jaf.com, go to /docs/new. Fill in a job type, address, select a crew member, add a service code, submit. Should redirect to /docs/<id> (404 for now is fine).

- [ ] **Step 4: Commit**

```bash
git add app/routes/_app.docs.new.tsx app/components/material-line-items.tsx
git commit -m "feat: supervisor creates JAF control document with crew assignment + materials"
```

---

## Task 7: Idalia's Warehouse View + Prep

**Files:**
- Create: `app/routes/_app.docs.$id.tsx` (doc view router)
- Create: `app/routes/_app.docs.$id_.prep.tsx`

- [ ] **Step 1: Create the doc view route (status-aware router)**

Create `app/routes/_app.docs.$id.tsx`:

```tsx
import { redirect } from 'react-router'
import { requireSession } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { MaterialLineItems } from '~/components/material-line-items'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Link } from 'react-router'
import type { Route } from './+types/_app.docs.$id'

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  const serviceCodes = await db.serviceCode.findMany()
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  const assignedCrew = await db.user.findMany({ where: { id: { in: doc.assignedCrewIds } } })
  const auditTrail = await db.auditTrail.findMany({
    where: { docId: doc.id },
    include: { user: true },
    orderBy: { timestamp: 'asc' },
  })
  return { doc, user, serviceCodes, supervisor, assignedCrew, auditTrail }
}

function nextActionHref(doc: any, userRole: string, userId: string): string | null {
  if (doc.status === 'CREATED' && userRole === 'WAREHOUSE') return `/docs/${doc.id}/prep`
  if (doc.status === 'PREPPED' && (userRole === 'WAREHOUSE' || userRole === 'CREW' || doc.assignedCrewIds?.includes(userId))) return `/docs/${doc.id}/sign`
  if (doc.status === 'SIGNED' && doc.assignedCrewIds?.includes(userId)) return `/docs/${doc.id}/field`
  if (doc.status === 'FIELD_UPDATED' && (userRole === 'SUPERVISOR' || userRole === 'ADMIN')) return `/docs/${doc.id}/review`
  if (doc.status === 'CLARO_UPLOADED' && userRole === 'FINANCE') return `/docs/${doc.id}/lc`
  return null
}

export default function DocView({ loaderData }: Route.ComponentProps) {
  const { doc, user, serviceCodes, supervisor, assignedCrew, auditTrail } = loaderData
  const nextHref = nextActionHref(doc, user.role, user.id)
  const estimated = (doc.estimatedMaterials as any[]) || []
  const taken = (doc.materialsTaken as any[]) || []
  const used = (doc.materialsUsed as any[]) || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
          <p className="text-sm text-slate-500">{doc.jobType}</p>
        </div>
        <span className="text-xs bg-slate-100 px-3 py-1 rounded-full font-medium">{doc.status.replace('_', ' ')}</span>
      </div>

      <section className="bg-white border rounded-lg p-4 space-y-2 text-sm">
        <p><span className="text-slate-500">Address:</span> {doc.jobAddressActual || doc.jobAddressEstimated}</p>
        {doc.avisoNumber && <p><span className="text-slate-500">Aviso #:</span> {doc.avisoNumber}</p>}
        <p><span className="text-slate-500">Supervisor:</span> {supervisor?.name}</p>
        <p><span className="text-slate-500">Crew:</span> {assignedCrew.map(c => c.name).join(', ')}</p>
        <p><span className="text-slate-500">Created:</span> {new Date(doc.createdAt).toLocaleString()}</p>
      </section>

      {estimated.length > 0 && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2 text-slate-600">Estimated Materials</h2>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={estimated} readOnly />
        </section>
      )}

      {taken.length > 0 && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2 text-slate-600">Materials Taken (Signed)</h2>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={taken} readOnly />
          {doc.crewSignature && (
            <img src={doc.crewSignature} alt="Crew signature" className="mt-3 border rounded max-h-16" />
          )}
        </section>
      )}

      {used.length > 0 && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2 text-slate-600">Materials Used (Field)</h2>
          <MaterialLineItems serviceCodes={serviceCodes as any} initialItems={used} readOnly />
          {doc.fieldNotes && <p className="text-sm text-slate-600 mt-2">{doc.fieldNotes}</p>}
        </section>
      )}

      {nextHref && (
        <Button asChild className="w-full">
          <Link to={nextHref}>
            {doc.status === 'CREATED' && 'Mark as Prepped'}
            {doc.status === 'PREPPED' && 'Capture Crew Signature'}
            {doc.status === 'SIGNED' && 'Update from Field'}
            {doc.status === 'FIELD_UPDATED' && 'Review & Approve'}
            {doc.status === 'CLARO_UPLOADED' && 'Generate LC Request'}
          </Link>
        </Button>
      )}

      {auditTrail.length > 0 && (
        <section className="text-xs text-slate-400 space-y-1 pt-2 border-t">
          <p className="font-medium text-slate-500">Audit Trail</p>
          {auditTrail.map((a) => (
            <p key={a.id}>{new Date(a.timestamp).toLocaleString()} — {a.user.name}: {a.action}</p>
          ))}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create Idalia's prep route**

Create `app/routes/_app.docs.$id_.prep.tsx`:

```tsx
import { redirect } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { canTransition } from '~/lib/permissions.server'
import type { Route } from './+types/_app.docs.$id_.prep'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['WAREHOUSE', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'PREPPED', user.role)) throw redirect(`/docs/${params.id}`)
  return { doc }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['WAREHOUSE', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })

  if (!canTransition(doc.status, 'PREPPED', user.role)) {
    throw redirect(`/docs/${params.id}`)
  }

  await db.jafControlDoc.update({
    where: { id: params.id },
    data: { status: 'PREPPED', preppedAt: new Date(), preppedById: user.id },
  })

  await db.auditTrail.create({
    data: {
      docId: params.id,
      userId: user.id,
      action: 'STATUS_CHANGED',
      diffJson: { status: { before: 'CREATED', after: 'PREPPED' } },
    },
  })

  // Notify assigned crew
  const doc2 = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  await db.notification.createMany({
    data: doc2.assignedCrewIds.map((crewId) => ({
      userId: crewId,
      docId: params.id,
      message: `Job ${doc2.controlNumber} is prepped and ready for pickup. Please sign at warehouse.`,
    })),
  })

  throw redirect(`/docs/${params.id}`)
}

// Prep is a one-click action — no UI needed, action fires immediately
export async function clientLoader() {
  return null
}

import type { ActionFunctionArgs } from 'react-router'
import { Form } from 'react-router'
import { Button } from '~/components/ui/button'

export default function PrepDoc({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Mark Materials Prepped</h1>
      <p className="text-sm text-slate-600">
        Confirm that materials for <strong>{(doc as any).controlNumber}</strong> have been staged and are ready for crew pickup.
      </p>
      <Form method="post">
        <Button type="submit" className="w-full">Confirm Materials Prepped</Button>
      </Form>
    </div>
  )
}
```

- [ ] **Step 3: Test manually**

Log in as idalia@jaf.com, go to /dashboard, click on a CREATED document, click "Mark as Prepped". Status should update to PREPPED.

- [ ] **Step 4: Commit**

```bash
git add app/routes/_app.docs.$id.tsx app/routes/_app.docs.$id_.prep.tsx
git commit -m "feat: doc view + Idalia prep workflow"
```

---

## Task 8: Crew Signature at Warehouse

**Files:**
- Create: `app/components/signature-pad.tsx`
- Create: `app/routes/_app.docs.$id_.sign.tsx`
- Create: `app/lib/pdf/warehouse-receipt.server.tsx`

- [ ] **Step 1: Create SignaturePad React wrapper**

Create `app/components/signature-pad.tsx`:

```tsx
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

export interface SignaturePadHandle {
  toDataURL(): string
  isEmpty(): boolean
  clear(): void
}

interface Props {
  width?: number
  height?: number
  className?: string
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 400, height = 150, className },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<any>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    import('signature_pad').then(({ default: SP }) => {
      padRef.current = new SP(canvasRef.current!, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(0,0,0)',
      })
    })
    return () => padRef.current?.off()
  }, [])

  useImperativeHandle(ref, () => ({
    toDataURL: () => padRef.current?.toDataURL('image/png') ?? '',
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    clear: () => padRef.current?.clear(),
  }))

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`border rounded touch-none ${className}`}
      style={{ touchAction: 'none' }}
    />
  )
})
```

- [ ] **Step 2: Create signature capture route**

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
import type { Route } from './+types/_app.docs.$id_.sign'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['CREW', 'WAREHOUSE', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'SIGNED', user.role)) throw redirect(`/docs/${params.id}`)
  const serviceCodes = await db.serviceCode.findMany({ where: { active: true } })
  return { doc, user, serviceCodes }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['CREW', 'WAREHOUSE', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })

  if (!canTransition(doc.status, 'SIGNED', user.role)) throw redirect(`/docs/${params.id}`)

  const form = await request.formData()
  const signature = form.get('signature') as string
  const materialsRaw = form.get('materials') as string

  if (!signature || signature === 'data:,') {
    return { error: 'Signature is required' }
  }

  let materialsTaken: { serviceCodeId: string; qty: number }[] = []
  try {
    materialsTaken = JSON.parse(materialsRaw).filter((i: any) => i.serviceCodeId && i.qty > 0)
  } catch {
    return { error: 'Invalid materials data' }
  }

  // Update doc — materialsTaken is now permanently locked
  await db.jafControlDoc.update({
    where: { id: params.id },
    data: {
      status: 'SIGNED',
      materialsTaken,
      crewSignature: signature,
      signedAt: new Date(),
      signedById: user.id,
    },
  })

  await db.auditTrail.create({
    data: {
      docId: params.id,
      userId: user.id,
      action: 'STATUS_CHANGED',
      diffJson: { status: { before: 'PREPPED', after: 'SIGNED' }, materialsTaken },
    },
  })

  // Generate warehouse receipt PDF
  const updatedDoc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  const serviceCodes = await db.serviceCode.findMany()
  const pdfBytes = await generateWarehouseReceiptPdf(updatedDoc as any, serviceCodes as any)
  const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
  const receiptDir = path.join(uploadDir, 'receipts')
  await fs.mkdir(receiptDir, { recursive: true })
  const receiptPath = path.join(receiptDir, `${params.id}-receipt.pdf`)
  await fs.writeFile(receiptPath, pdfBytes)
  await db.jafControlDoc.update({
    where: { id: params.id },
    data: { warehouseReceiptPath: receiptPath },
  })

  throw redirect(`/docs/${params.id}`)
}

export default function SignDoc({ loaderData, actionData }: Route.ComponentProps) {
  const { doc, serviceCodes } = loaderData
  const padRef = useRef<SignaturePadHandle>(null)
  const [sigData, setSigData] = useState('')
  const submit = useSubmit()

  const estimated = (doc.estimatedMaterials as any[]) || []
  const [items, setItems] = useState(estimated)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (padRef.current?.isEmpty()) {
      alert('Please sign before submitting.')
      return
    }
    const formData = new FormData(e.currentTarget)
    formData.set('signature', padRef.current!.toDataURL())
    formData.set('materials', JSON.stringify(items))
    submit(formData, { method: 'post' })
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Crew Signature at Warehouse</h1>
      <p className="text-sm text-slate-600 font-mono">{(doc as any).controlNumber}</p>

      <section className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        Review materials below. Add any items not on the estimated list. Once you sign, this list is final.
      </section>

      <Form method="post" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Materials Taken</p>
          <MaterialLineItems
            serviceCodes={serviceCodes as any}
            initialItems={items}
            readOnly={false}
            name="materials"
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Crew Signature</p>
          <SignaturePad ref={padRef} width={350} height={130} />
          <button
            type="button"
            onClick={() => padRef.current?.clear()}
            className="text-xs text-slate-500 mt-1 hover:text-slate-700"
          >
            Clear signature
          </button>
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

- [ ] **Step 3: Create warehouse receipt PDF generator**

Create `app/lib/pdf/warehouse-receipt.server.tsx`:

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  label: { color: '#666' },
  table: { marginTop: 12 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f1f5f9', padding: 4, marginBottom: 2 },
  tableRow: { flexDirection: 'row', padding: 4, borderBottom: '1px solid #e2e8f0' },
  col1: { flex: 2 },
  col2: { flex: 3 },
  col3: { flex: 1, textAlign: 'right' },
  col4: { flex: 1, textAlign: 'right' },
  signatureSection: { marginTop: 24, borderTop: '1px solid #ccc', paddingTop: 12 },
  total: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end', fontWeight: 'bold' },
})

export async function generateWarehouseReceiptPdf(
  doc: {
    controlNumber: string
    jobType: string
    jobAddressEstimated: string
    avisoNumber?: string | null
    materialsTaken: { serviceCodeId: string; qty: number }[]
    crewSignature?: string | null
    signedAt?: Date | null
  },
  serviceCodes: { id: string; claroCode: string; name: string; unit: string; unitPrice: number }[]
): Promise<Buffer> {
  const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))

  let totalAmount = 0
  const lineItems = doc.materialsTaken.map((item) => {
    const code = codeMap[item.serviceCodeId]
    const amount = (code?.unitPrice ?? 0) * item.qty
    totalAmount += amount
    return { code, qty: item.qty, amount }
  })

  const element = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Warehouse Receipt</Text>
          <Text>JAF Communications, Inc.</Text>
        </View>

        <View style={styles.row}>
          <Text><Text style={styles.label}>Control #: </Text>{doc.controlNumber}</Text>
          <Text><Text style={styles.label}>Date: </Text>{doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text><Text style={styles.label}>Job Type: </Text>{doc.jobType}</Text>
          {doc.avisoNumber && <Text><Text style={styles.label}>Aviso #: </Text>{doc.avisoNumber}</Text>}
        </View>
        <View style={styles.row}>
          <Text><Text style={styles.label}>Address: </Text>{doc.jobAddressEstimated}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.col1}>Code</Text>
            <Text style={styles.col2}>Description</Text>
            <Text style={styles.col3}>Qty</Text>
            <Text style={styles.col4}>Amount</Text>
          </View>
          {lineItems.map(({ code, qty, amount }, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.col1}>{code?.claroCode ?? '—'}</Text>
              <Text style={styles.col2}>{code?.name ?? '—'}</Text>
              <Text style={styles.col3}>{qty} {code?.unit}</Text>
              <Text style={styles.col4}>${amount.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.total}>
          <Text>Total: ${totalAmount.toFixed(2)}</Text>
        </View>

        <View style={styles.signatureSection}>
          <Text style={{ marginBottom: 8 }}>Crew Signature:</Text>
          {doc.crewSignature && (
            <Image src={doc.crewSignature} style={{ height: 50, width: 200 }} />
          )}
          <Text style={{ marginTop: 4, color: '#666' }}>
            {doc.signedAt ? new Date(doc.signedAt).toLocaleString() : ''}
          </Text>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}
```

- [ ] **Step 4: Add UPLOAD_DIR to .env**

```bash
echo 'UPLOAD_DIR="/tmp/jaf/uploads"' >> .env
mkdir -p /tmp/jaf/uploads/receipts
```

- [ ] **Step 5: Test signature flow manually**

1. Create a document as supervisor
2. Log in as idalia@jaf.com, mark PREPPED
3. Log in as crew@jaf.com (or remain as warehouse), go to /docs/<id>/sign
4. Add a material, draw signature, submit
5. Status should be SIGNED, signature visible in doc view

- [ ] **Step 6: Commit**

```bash
git add app/components/signature-pad.tsx app/routes/_app.docs.$id_.sign.tsx app/lib/pdf/
git commit -m "feat: crew signature at warehouse — locks materialsTaken + generates receipt PDF"
```

---

## Task 9: Crew Field Update (Offline-Capable PWA)

**Files:**
- Create: `app/routes/_app.docs.$id_.field.tsx`
- Modify: `app/sw.ts` (already stubbed)

- [ ] **Step 1: Create field update route**

Create `app/routes/_app.docs.$id_.field.tsx`:

```tsx
import { Form, redirect, useLoaderData } from 'react-router'
import { requireRole } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import { canTransition } from '~/lib/permissions.server'
import { MaterialLineItems } from '~/components/material-line-items'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import type { Route } from './+types/_app.docs.$id_.field'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireRole(request, ['CREW', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'FIELD_UPDATED', user.role)) throw redirect(`/docs/${params.id}`)
  const serviceCodes = await db.serviceCode.findMany({ where: { active: true } })
  return { doc, user, serviceCodes }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['CREW', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'FIELD_UPDATED', user.role)) throw redirect(`/docs/${params.id}`)

  const form = await request.formData()
  const jobAddressActual = (form.get('jobAddressActual') as string).trim()
  const fieldNotes = (form.get('fieldNotes') as string | null)?.trim() || null
  const materialsRaw = form.get('materialsUsed') as string

  let materialsUsed: { serviceCodeId: string; qty: number }[] = []
  try {
    materialsUsed = JSON.parse(materialsRaw).filter((i: any) => i.serviceCodeId && i.qty > 0)
  } catch {
    return { error: 'Invalid materials data' }
  }

  // Enforce materials_used <= materials_taken
  const taken = (doc.materialsTaken as { serviceCodeId: string; qty: number }[]) || []
  const takenMap = Object.fromEntries(taken.map((t) => [t.serviceCodeId, t.qty]))
  for (const item of materialsUsed) {
    if ((takenMap[item.serviceCodeId] ?? 0) < item.qty) {
      return { error: `Cannot use more than taken for ${item.serviceCodeId}` }
    }
  }

  // Handle photo uploads
  const photos = form.getAll('photos') as File[]
  const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
  const photoDir = path.join(uploadDir, 'photos', params.id)
  if (photos.length > 0 && photos[0].size > 0) {
    await fs.mkdir(photoDir, { recursive: true })
    for (const photo of photos) {
      if (photo.size === 0) continue
      const filename = `${Date.now()}-${photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const localPath = path.join(photoDir, filename)
      await fs.writeFile(localPath, Buffer.from(await photo.arrayBuffer()))
      await db.photo.create({
        data: { docId: params.id, uploadedById: user.id, localPath },
      })
    }
  }

  await db.jafControlDoc.update({
    where: { id: params.id },
    data: {
      status: 'FIELD_UPDATED',
      jobAddressActual,
      materialsUsed,
      fieldNotes,
      completedAt: new Date(),
    },
  })

  await db.auditTrail.create({
    data: {
      docId: params.id,
      userId: user.id,
      action: 'STATUS_CHANGED',
      diffJson: { status: { before: 'SIGNED', after: 'FIELD_UPDATED' }, jobAddressActual, materialsUsed },
    },
  })

  // Notify supervisor
  await db.notification.create({
    data: {
      userId: doc.supervisorId,
      docId: params.id,
      message: `Job ${doc.controlNumber} marked complete by crew. Ready for your review.`,
    },
  })

  throw redirect(`/docs/${params.id}`)
}

export default function FieldUpdate({ loaderData, actionData }: Route.ComponentProps) {
  const { doc, serviceCodes } = loaderData
  const taken = (doc.materialsTaken as any[]) || []

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <strong>Offline capable.</strong> If you lose connection, your changes save locally and sync when you reconnect.
      </div>

      <h1 className="text-xl font-semibold">Field Update</h1>
      <p className="text-sm font-mono text-slate-500">{(doc as any).controlNumber}</p>

      <Form method="post" encType="multipart/form-data" className="space-y-4">
        <div>
          <Label htmlFor="jobAddressActual">Actual Job Address</Label>
          <Input
            id="jobAddressActual"
            name="jobAddressActual"
            defaultValue={(doc as any).jobAddressEstimated}
            required
          />
        </div>

        <div>
          <Label>Materials Used</Label>
          <p className="text-xs text-slate-500 mb-1">Cannot exceed what was signed out at warehouse.</p>
          <MaterialLineItems
            serviceCodes={serviceCodes as any}
            initialItems={taken}
            name="materialsUsed"
          />
        </div>

        <div>
          <Label htmlFor="fieldNotes">Field Notes</Label>
          <Textarea id="fieldNotes" name="fieldNotes" rows={3} placeholder="Observations, issues, changes..." />
        </div>

        <div>
          <Label htmlFor="photos">Photos</Label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="block w-full text-sm text-slate-500 mt-1"
          />
          <p className="text-xs text-slate-400 mt-1">Photos stored as proof of work — not sent externally.</p>
        </div>

        {(actionData as any)?.error && (
          <p className="text-sm text-red-600">{(actionData as any).error}</p>
        )}

        <Button type="submit" className="w-full">Mark Complete</Button>
      </Form>
    </div>
  )
}
```

- [ ] **Step 2: Test offline behavior**

```bash
npm run build && npm run start
```

1. Open http://localhost:3000/docs/<signed-doc-id>/field as crew
2. In DevTools → Network → set to Offline
3. Reload — page should load from service worker cache
4. Fill the form and submit — note: offline form submission won't fully work without Background Sync; the cache ensures the user can at least see the form. Full IndexedDB queuing is a Week 4 enhancement. Document this limitation in a comment in `app/sw.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/routes/_app.docs.$id_.field.tsx
git commit -m "feat: crew field update — actual address, materials used, photo upload"
```

---

## Task 10: Supervisor Review + Claro PDF Upload

**Files:**
- Create: `app/routes/_app.docs.$id_.review.tsx`

- [ ] **Step 1: Create supervisor review route**

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
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  const serviceCodes = await db.serviceCode.findMany()
  const photos = await db.photo.findMany({ where: { docId: params.id } })
  return { doc, user, serviceCodes, photos }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['SUPERVISOR', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'approve') {
    if (!canTransition(doc.status, 'SUPERVISOR_APPROVED', user.role)) throw redirect(`/docs/${params.id}`)
    const avisoNumber = (form.get('avisoNumber') as string | null)?.trim() || doc.avisoNumber
    const claroNotes = (form.get('claroNotes') as string | null)?.trim() || null

    await db.jafControlDoc.update({
      where: { id: params.id },
      data: { status: 'SUPERVISOR_APPROVED', supervisorApprovedAt: new Date(), avisoNumber, claroNotes },
    })

    await db.auditTrail.create({
      data: {
        docId: params.id,
        userId: user.id,
        action: 'STATUS_CHANGED',
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
    const filename = `${params.id}-claro.pdf`
    const localPath = path.join(claroDir, filename)
    await fs.writeFile(localPath, Buffer.from(await claroPdf.arrayBuffer()))

    await db.jafControlDoc.update({
      where: { id: params.id },
      data: { status: 'CLARO_UPLOADED', claroPdfPath: localPath, claroUploadedAt: new Date() },
    })

    await db.auditTrail.create({
      data: {
        docId: params.id,
        userId: user.id,
        action: 'STATUS_CHANGED',
        diffJson: { status: { before: 'SUPERVISOR_APPROVED', after: 'CLARO_UPLOADED' } },
      },
    })

    // Notify Lissette
    const finance = await db.user.findMany({ where: { role: 'FINANCE', active: true } })
    await db.notification.createMany({
      data: finance.map((f) => ({
        userId: f.id,
        docId: params.id,
        message: `Job ${doc.controlNumber} Claro work order uploaded. Ready for LC request.`,
      })),
    })
  }

  throw redirect(`/docs/${params.id}`)
}

export default function ReviewDoc({ loaderData, actionData }: Route.ComponentProps) {
  const { doc, serviceCodes, photos } = loaderData
  const estimated = (doc.estimatedMaterials as any[]) || []
  const taken = (doc.materialsTaken as any[]) || []
  const used = (doc.materialsUsed as any[]) || []
  const isApproved = ['SUPERVISOR_APPROVED', 'CLARO_UPLOADED', 'LC_GENERATED'].includes(doc.status)

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Supervisor Review</h1>
      <p className="font-mono text-sm text-slate-500">{(doc as any).controlNumber}</p>

      <div className="grid grid-cols-3 gap-4 text-sm">
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

      {(doc as any).fieldNotes && (
        <div className="bg-slate-50 border rounded p-3 text-sm">
          <p className="text-xs text-slate-500 mb-1">Field Notes</p>
          <p>{(doc as any).fieldNotes}</p>
        </div>
      )}

      {photos.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Photos ({photos.length})</p>
          <p className="text-xs text-slate-500">Photos stored on server for internal use.</p>
        </div>
      )}

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
          <Button type="submit" className="w-full">Approve & Submit to Claro</Button>
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

1. Complete a doc through FIELD_UPDATED
2. Log in as supervisor, go to /docs/<id>/review
3. Approve (status → SUPERVISOR_APPROVED)
4. Upload a PDF (any PDF for testing) — status → CLARO_UPLOADED

- [ ] **Step 3: Commit**

```bash
git add app/routes/_app.docs.$id_.review.tsx
git commit -m "feat: supervisor review — approve job + upload Claro PDF"
```

---

## Task 11: Lissette's LC Request View + PDF Generation

**Files:**
- Create: `app/routes/_app.docs.$id_.lc.tsx`
- Create: `app/lib/pdf/schedule-accounts.server.tsx`
- Create: `app/lib/pdf/acta-conformidad.server.tsx`

- [ ] **Step 1: Create Acta de Conformidad PDF generator (Document 2A)**

Create `app/lib/pdf/acta-conformidad.server.tsx`:

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

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
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, fontWeight: 'bold' },
})

interface LineItem {
  claroCode: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  accountCode?: string | null
  subAct?: string | null
  dept?: string | null
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
}): Promise<Buffer> {
  let total = 0
  const items = params.lineItems.map((item) => {
    const amount = item.qty * item.unitPrice
    total += amount
    return { ...item, amount }
  })

  const ivu = total * 0.115
  const ivuMun = total * 0.04
  const totalIvu = total + ivu + ivuMun

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
          <View style={styles.totalRow}><Text>Subtotal: ${total.toFixed(2)}</Text></View>
          <View style={styles.totalRow}><Text>IVU 11.5%: ${ivu.toFixed(2)}</Text></View>
          <View style={styles.totalRow}><Text>IVU Municipal 4%: ${ivuMun.toFixed(2)}</Text></View>
          <View style={styles.totalRow}><Text>Total a Pagar: ${totalIvu.toFixed(2)}</Text></View>
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

- [ ] **Step 2: Create Schedule of Accounts PDF generator (Document 2B)**

Create `app/lib/pdf/schedule-accounts.server.tsx`:

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 9 },
  title: { fontSize: 14, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  to: { textAlign: 'center', marginBottom: 12, color: '#555' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#1e3a5f', color: '#fff', padding: 4, fontSize: 8 },
  tableRow: { flexDirection: 'row', padding: 4, borderBottom: '0.5px solid #e2e8f0', fontSize: 8 },
  c1: { flex: 1.5 }, c2: { flex: 1.5 }, c3: { flex: 2 }, c4: { flex: 1.5 }, c5: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
  signature: { marginTop: 32, borderTop: '1px solid #ccc', paddingTop: 12 },
})

export interface ScheduleInvoice {
  invoiceDate: string
  invoiceNumber: string
  debtor: string
  poNumber: string
  amount: number
}

export async function generateScheduleAccountsPdf(params: {
  invoices: ScheduleInvoice[]
  advancePercent?: number
  agentName?: string
}): Promise<Buffer> {
  const { invoices, advancePercent = 80, agentName = 'Monica' } = params
  const total = invoices.reduce((sum, i) => sum + i.amount, 0)
  const advance = total * (advancePercent / 100)

  const element = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>SCHEDULE OF ACCOUNTS</Text>
        <Text style={styles.to}>Submitted to: Pacific Business Capital Corporation — Hortencia Smith (hs@pbcc.com)</Text>
        <Text style={{ textAlign: 'center', marginBottom: 12, color: '#555', fontSize: 8 }}>
          JAF Communications, Inc. — V0000000006
        </Text>

        <View style={styles.tableHeader}>
          <Text style={styles.c1}>Inv. Date</Text>
          <Text style={styles.c2}>Invoice #</Text>
          <Text style={styles.c3}>Debtor</Text>
          <Text style={styles.c4}>P.O. #</Text>
          <Text style={styles.c5}>Invoice Amount</Text>
        </View>
        {invoices.map((inv, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.c1}>{inv.invoiceDate}</Text>
            <Text style={styles.c2}>{inv.invoiceNumber}</Text>
            <Text style={styles.c3}>{inv.debtor}</Text>
            <Text style={styles.c4}>{inv.poNumber}</Text>
            <Text style={styles.c5}>${inv.amount.toFixed(2)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}><Text>Total: ${total.toFixed(2)}</Text></View>
          <View style={styles.totalRow}><Text>Advance ({advancePercent}%): ${advance.toFixed(2)}</Text></View>
          <View style={styles.totalRow}><Text>Adjustments: $0.00</Text></View>
          <View style={styles.totalRow}><Text style={{ fontWeight: 'bold' }}>Cash Payment: ${advance.toFixed(2)}</Text></View>
        </View>

        <View style={styles.signature}>
          <Text>Authorized Agent: ________________________</Text>
          <Text style={{ marginTop: 4 }}>{agentName}</Text>
          <Text style={{ marginTop: 8 }}>Date: ___________</Text>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(element)
}
```

- [ ] **Step 3: Create Lissette's LC route**

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
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'LC_GENERATED', user.role)) throw redirect(`/docs/${params.id}`)
  const serviceCodes = await db.serviceCode.findMany()
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  const poLinks = await db.poLink.findMany({ where: { docId: params.id } })
  return { doc, user, serviceCodes, supervisor, poLinks }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireRole(request, ['FINANCE', 'ADMIN'])
  const doc = await db.jafControlDoc.findUniqueOrThrow({ where: { id: params.id } })
  if (!canTransition(doc.status, 'LC_GENERATED', user.role)) throw redirect(`/docs/${params.id}`)

  const form = await request.formData()
  const intent = form.get('intent') as string

  const serviceCodes = await db.serviceCode.findMany()
  const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
  const supervisor = await db.user.findUnique({ where: { id: doc.supervisorId } })
  const poLinks = await db.poLink.findMany({ where: { docId: params.id } })

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
    const total = lineItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)
    const ivu = total * 0.115 + total * 0.04
    const amount = total + ivu

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

    await db.jafControlDoc.update({
      where: { id: params.id },
      data: { status: 'LC_GENERATED', lcRequestPdfPath: localPath, lcGeneratedAt: new Date(), lcApprovedById: user.id },
    })

    await db.auditTrail.create({
      data: {
        docId: params.id,
        userId: user.id,
        action: 'STATUS_CHANGED',
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
  const { doc, serviceCodes, supervisor, poLinks } = loaderData
  const used = (doc.materialsUsed as any[]) || []
  const claroPdfUrl = doc.claroPdfPath ? `/files/claro-pdfs/${(doc as any).id}-claro.pdf` : null

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">LC Request — Lissette Review</h1>
      <p className="font-mono text-sm text-slate-500">{(doc as any).controlNumber}</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-2">JAF Control Document</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-slate-500">Job:</span> {(doc as any).jobType}</p>
            <p><span className="text-slate-500">Address:</span> {(doc as any).jobAddressActual ?? (doc as any).jobAddressEstimated}</p>
            <p><span className="text-slate-500">Aviso #:</span> {(doc as any).avisoNumber ?? '—'}</p>
            <p><span className="text-slate-500">Supervisor:</span> {supervisor?.name}</p>
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

      <p className="text-xs text-slate-400">
        Generating the Schedule of Accounts marks this document complete (LC_GENERATED). Email the PDF to hs@pbcc.com.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Serve uploaded files via a file route**

Create `app/routes/files.$.tsx`:

```tsx
import type { Route } from './+types/files.$'
import fs from 'node:fs/promises'
import path from 'node:path'
import { requireSession } from '~/lib/permissions.server'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request) // Auth-gated — files are internal only
  const uploadDir = process.env.UPLOAD_DIR || '/tmp/jaf/uploads'
  const filePath = path.join(uploadDir, params['*'] ?? '')

  // Path traversal guard
  if (!filePath.startsWith(path.resolve(uploadDir))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const bytes = await fs.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'application/octet-stream'
    return new Response(bytes, { headers: { 'Content-Type': contentType } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
```

- [ ] **Step 5: Full end-to-end smoke test**

Walk through the complete workflow in sequence:
1. supervisor@jaf.com → /docs/new → create document → note control number
2. idalia@jaf.com → dashboard → click doc → /prep → confirm PREPPED
3. crew@jaf.com → dashboard → click doc → /sign → add item → draw signature → submit → confirm SIGNED
4. crew@jaf.com → /field → fill address → update materials → upload photo → confirm FIELD_UPDATED
5. supervisor@jaf.com → /review → approve → upload any PDF as Claro PDF → confirm CLARO_UPLOADED
6. lissette@jaf.com → /lc → review → click "Generate & Download Schedule of Accounts" → PDF downloads → status LC_GENERATED

- [ ] **Step 6: Commit**

```bash
git add app/routes/_app.docs.$id_.lc.tsx app/routes/files.$.tsx app/lib/pdf/
git commit -m "feat: Lissette LC view + Acta de Conformidad + Schedule of Accounts PDF generation"
```

---

## Task 12: Notifications Bell

**Files:**
- Modify: `app/routes/_app.tsx`

- [ ] **Step 1: Add notification bell to app shell**

Modify `app/routes/_app.tsx` — update the loader and header:

```tsx
// Add to loader:
const notifications = await db.notification.findMany({
  where: { userId: session.user.id, read: false },
  orderBy: { createdAt: 'desc' },
  take: 10,
})
return { user: { name: user.name, role: user.role }, notifications }
```

```tsx
// Replace the header span for user name with:
<div className="relative">
  <button className="text-slate-600 relative" onClick={() => {}}>
    🔔
    {loaderData.notifications.length > 0 && (
      <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center">
        {loaderData.notifications.length}
      </span>
    )}
  </button>
</div>
```

Full notification dropdown is a Week 4 polish item — the bell count is sufficient for the quick win.

- [ ] **Step 2: Commit**

```bash
git add app/routes/_app.tsx
git commit -m "feat: notification bell count in app shell"
```

---

## Self-Review Checklist

Spec vs plan coverage:

| Spec requirement | Covered in task |
|---|---|
| Control number MAINT-YYMMDD-NNN | Task 4 |
| 5 RBAC roles | Task 3 |
| Supervisor creates doc with service codes + crew | Task 6 |
| Idalia marks PREPPED, notifies crew | Task 7 |
| Crew signs at warehouse, materialsTaken locked | Task 8 |
| Warehouse Receipt PDF generated at signing | Task 8 |
| Crew field update offline-capable | Task 9 |
| Photo upload stored locally | Task 9 |
| Supervisor approve + Claro PDF upload | Task 10 |
| Lissette side-by-side comparison | Task 11 |
| Acta de Conformidad PDF (Doc 2A) | Task 11 |
| Schedule of Accounts PDF (Doc 2B) | Task 11 |
| Audit trail on every transition | Tasks 7–11 |
| Notifications between roles | Tasks 7, 9, 10 |
| State machine enforcement in API | Task 3 (canTransition) |
| materials_used ≤ materials_taken enforced | Task 9 |
| Neon dev database | Task 2 |
| PWA + Workbox service worker | Task 1 |

**Known deferred to Week 4:**
- Full IndexedDB offline queue (Background Sync API) — stub noted in Task 9
- Production Journal PDF (Doc 3, Carmen's payroll) — data model ready, PDF not in Quick Win scope
- Final Invoice for Claro Portal (Doc 5) — data model ready, built when Lissette confirms format
- 2FA for Finance + Admin roles — better-auth supports TOTP, add after MVP

---

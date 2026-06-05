# JAF Unified Operations Platform — Design Spec

**Date:** 2026-06-04
**Status:** Approved for implementation planning
**Supersedes:** `2026-06-02-jaf-operations-platform-design.md`

---

## Executive Summary

JAF Operations needs to close three broken handoffs: unaccountable material disbursement, untracked maintenance field operations, and manual multi-system invoicing. This system replaces those broken handoffs with a single traveling document — the JAF Invoice — that enforces accountability at every step, from supervisor intake through warehouse pickup, field completion, Claro submission, and bank LC request.

The JAF Invoice is the spine of the maintenance pipeline. It begins at intake (service call received) and accumulates data through job completion. Every downstream document — warehouse receipt, Acta de Conformidad, Production Journal, LC request, Final Invoice — is generated from it with no re-entry.

Material tracking exists to close audit exposure. Claro audits 3 times a year: if waste exceeds 10% of what Claro supplied vs what was used, JAF is liable for the difference. Claro pays on fixed 30/60/90/120-day terms depending on the job — that is simply Claro's payment schedule and is unrelated to material discrepancy.

**Quick win (Weeks 1–4):** Close the maintenance accountability loop entirely.
**Full system (Month 2):** Installation field ops + Lissette's unified reconciliation dashboard.

---

## Problem Summary

- **Maintenance crew:** Supervisor receives service call → creates job verbally → materials leave warehouse with no receipt → supervisor reconstructs from memory days later → Lissette receives conflicting material counts → reconciliation is slow
- **Audit liability:** No system tracks materials received from Claro vs issued to crews vs used on jobs. Waste percentage is unknown until Claro audits — at which point JAF may owe money
- **Installation crew:** No consumption baseline → VP bypasses Idalia's authority with no signed record → no accountability
- **Invoicing:** Same data entered 3–4 times across IBS, FoxPro, Excel, WinPay
- **Root cause:** Supervisor has no system. No intake record, no material tracking, no signed proof.

---

## Architecture

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | React Router v7 (framework mode) | Form-heavy workflows, best-in-class progressive enhancement, clean offline story, not Vercel-dependent |
| Database | PostgreSQL | Single source of truth, relational integrity for control numbers |
| ORM | Prisma | Schema-as-code, type-safe queries, migrations built in |
| Auth | better-auth | Session-based, RBAC, works natively with RR7, actively maintained |
| Styling | Tailwind CSS + shadcn/ui | Fast to build, consistent across mobile and desktop |
| PWA | vite-plugin-pwa + Workbox | Offline-first for field crew on spotty connections |
| Signatures | SignaturePad.js | Digital signature capture — every handoff signed twice |
| PDF generation | @react-pdf/renderer | All document outputs generated from JAF data |
| File storage | Local filesystem + Nginx | Photos and PDFs served from on-premise server — no object storage |
| Dev database | Neon PostgreSQL | White Elephants shared Neon instance for development |
| Prod deployment | On-premise Linux VM | Client-provisioned server, dedicated VM, 1Gbps private network + public IP |

### Five-Layer Architecture

```
CLIENT LAYER (PWA)
  ├── Field App (mobile-first)       — Crew + Supervisors
  ├── Warehouse Desk (tablet)        — Idalia + warehouse staff
  └── Finance / Management (desktop) — Lissette / Carmen / Management

API LAYER (RR7 loaders + actions)
  ├── Auth / RBAC
  ├── Control # Engine
  ├── JAF Invoice API
  ├── Dual-signature capture
  └── PDF export

PROCESSING LAYER
  ├── Invoice state machine
  ├── Variance calculator (audit compliance — issued vs used vs 10% threshold)
  ├── Consignment ledger (received / issued / used / returned)
  ├── Audit package generator (per control #)
  ├── LC request generator
  └── Audit logger

DATA LAYER (PostgreSQL + Prisma)

EXTERNAL (export-only / manual)
  ├── Claro portal — supervisor copies from JAF submission helper, uploads resulting PDFs back
  ├── Claro TOA   — Carmen reads for warranty validation (no integration)
  └── Bank (PBCC) — LC request PDF emailed by Lissette
```

### Data Re-entry Policy

Every data point enters the system once, at its earliest natural point. Downstream documents and views pull from that record. Where external systems require manual entry (Claro portal — no API; PBCC — email submission), JAF pre-fills and displays the exact data in the exact format needed so the operator copies rather than reconstructs. The only re-entry that remains is architecturally unavoidable.

---

## Core Data Model

### JAF Invoice (central entity)

The JAF Invoice is an operational record — not a billing invoice. It begins at service call intake and accumulates data through job completion. The actual billing documents (Acta de Conformidad, Final Invoice for Claro) are generated from it. Fields lock at each workflow step to prevent retroactive edits.

```
jaf_invoice
  id                    uuid PK
  control_number        string UNIQUE  (MAINT-YYMMDD-seq)
  status                enum (see state machine below)

  -- Supervisor fills at intake (Step 1)
  job_type              string
  job_address_estimated string
  estimated_materials   jsonb          [{serviceCodeId, qty}]
  assigned_crew_ids     uuid[]
  supervisor_id         uuid FK → users
  aviso_number          string?        (Claro-assigned; supervisor enters when known)
  created_at            timestamp

  -- Warehouse prep (Step 2) — optional if crew has van materials
  prepped_at            timestamp?
  prepped_by_id         uuid FK → users?

  -- Dual signature at warehouse pickup (Step 3) — LOCKS materials_taken
  -- warehouse_id set here, not at prep — crew may pull from a different zone warehouse
  warehouse_id          uuid FK → warehouses  (which of the 3 zone warehouses crew actually pulled from)
  materials_taken       jsonb?         [{serviceCodeId, qty}]  locked at signature
  release_signature     text?          (base64) — warehouse person signs (gives)
  released_by_id        uuid FK → users?
  release_signed_at     timestamp?
  crew_signature        text?          (base64) — crew member signs (receives)
  signed_by_id          uuid FK → users?
  signed_at             timestamp?

  -- Admin override (any step — VP/CEO bypasses normal flow)
  overridden_by_id      uuid FK → users?   (Admin role only — records which Admin)
  override_signature    text?          (base64)
  override_at           timestamp?
  override_reason       text?

  -- Crew field update (Step 4) — also entry point when crew bypasses warehouse
  job_address_actual    string?
  materials_used        jsonb?         [{serviceCodeId, qty}]  must be ≤ materials_taken
  field_notes           text?
  completed_at          timestamp?

  -- Supervisor approval + Claro submission (Step 5)
  supervisor_approved_at    timestamp?
  claro_pdf_path            string?    (local path — Claro work order PDF uploaded back)
  claro_uploaded_at         timestamp?

  -- Lissette generates LC (Step 6)
  lc_request_pdf_path   string?
  lc_generated_at       timestamp?
  lc_approved_by_id     uuid FK → users?

  -- Payment tracking (Finance dashboard)
  advance_received_at   timestamp?     (80% from PBCC)
  advance_amount        decimal?
  final_payment_received_at  timestamp?  (remaining % from Claro)
  final_payment_amount  decimal?
  receivable_closed_at  timestamp?
  receivable_closed_by_id  uuid FK → users?

  -- Generated documents
  warehouse_receipt_path   string?
```

### Supporting Tables

```
users
  id, name, email, role, phone, active

warehouses
  id, name, zone, location, active
  -- 3 zone sub-warehouses; crew may pull from nearest or any warehouse

audit_trail
  id, invoice_id, user_id, action, diff_json, timestamp
  -- append-only; no record can be deleted

photos
  id, document_id, uploaded_by, local_path, taken_at
  -- stored on-premise, served via Nginx
  -- retrievable from job record; required source data for supervisor's Claro submission

service_codes
  id, claro_code, name, description, unit, unit_price, account_code,
  sub_act, dept, profit_center, act, cost_center_code, active
  -- Claro contract service codes with pricing (e.g. 34006428 @ $0.36/SR)

po_links
  id, invoice_id, claro_po_number, acceptance_number, amount
  -- one invoice can have multiple Claro POs

notifications
  id, user_id, doc_id, message, read, created_at

van_restock_requests
  id
  requested_by_id       uuid FK → users
  warehouse_id          uuid FK → warehouses
  items                 jsonb   [{serviceCodeId, qty}]
  status                enum (REQUESTED → FULFILLED)
  -- Dual signature (same rule as job-triggered handoffs)
  release_signature     text?   (base64) — warehouse person signs
  released_by_id        uuid FK → users?
  release_signed_at     timestamp?
  receiver_signature    text?   (base64) — crew member signs
  receiver_signed_by_id uuid FK → users?
  receiver_signed_at    timestamp?
  -- Admin override (same rule as job-triggered handoffs)
  overridden_by_id      uuid FK → users?   (Admin role only)
  override_signature    text?
  override_at           timestamp?
  override_reason       text?
  created_at            timestamp

consignment_receipts
  id
  warehouse_id          uuid FK → warehouses
  received_by_id        uuid FK → users
  delivery_date         date
  items                 jsonb   [{serviceCodeId, qty}]
  notes                 text?
  created_at            timestamp
  -- Admin logs Claro bulk material deliveries (periodic, a few times/year)
  -- Powers the consignment ledger: received → issued → used → returned → waste %
  -- "Issued" = materials_taken across all jaf_invoices + items across all fulfilled van_restock_requests
  -- Both disbursement flows draw from Claro consignment stock and must be counted
  -- Open item: confirm waste formula with JAF — likely (issued − used − returned) / received

system_settings
  id, key (unique), value, updated_by_id, updated_at
  -- Configurable system values (e.g. ivu_rate = "0.115")
  -- Admin-managed; PDF generation pulls from here, never hardcoded
```

### Important: Service Codes vs Materials

Claro's system works on **service codes** (e.g. `34006428 REMOCION MENSAJERO`), not raw material names. The service catalog stores these codes with their contract unit prices. When a supervisor creates a JAF Invoice they select from this catalog — quantities and prices auto-populate. This drives all downstream document formats.

### Important: Dual Signature Rule

Every material handoff — whether job-triggered or van restock — is signed twice: the person who gives signs (release), and the person who takes signs (receipt). If an Admin (VP/CEO) overrides a request, the override is also signed. This rule applies uniformly across all disbursement flows.

### State Machine

| Transition | Who triggers it | What locks | Notes |
|---|---|---|---|
| CREATED → PREPPED | Warehouse / Admin | — | Invoice IS the material request; Idalia fulfills it |
| PREPPED → SIGNED | Crew + Warehouse / Admin | `materials_taken` locked permanently | Dual signature: warehouse releases, crew receives |
| SIGNED → FIELD_UPDATED | Crew / Admin | — | |
| **CREATED → FIELD_UPDATED** | **Crew / Admin** | — | **Direct path: crew has sufficient van materials, no warehouse stop needed** |
| FIELD_UPDATED → SUPERVISOR_APPROVED | Supervisor / Admin | — | |
| SUPERVISOR_APPROVED → CLARO_UPLOADED | Supervisor / Admin | `claro_pdf_path` set | |
| CLARO_UPLOADED → LC_GENERATED | Finance / Admin | `lc_request_pdf_path` generated | |

`materials_used` must be ≤ `materials_taken` (enforced at API layer). Purpose: audit compliance — Claro audits 3x/year; waste > 10% of supplied = JAF liability.

---

## Roles & Permissions

| Role | Access |
|---|---|
| **Supervisor** | Create invoices (intake), review crew updates, approve, upload Claro PDF, view own jobs |
| **Crew** | View assigned invoices, sign at warehouse (receiver), update field data, upload photos, request van restocks |
| **Warehouse (Idalia)** | View all pending invoices, mark prepped, sign at warehouse (releaser), log consignment receipts, fulfill van restock requests |
| **Finance (Lissette)** | View approved+uploaded invoices, compare JAF vs Claro PDF, generate LC requests, manage receivables dashboard |
| **Admin** | Full access, user management, catalog, audit trail, system settings (IVU rate), authorize overrides — VP/CEO overrides map to this role; override record captures which specific Admin authorized it |

Route-level protection enforced at the RR7 loader level — unauthorized access returns a redirect, not a 403.

---

## Material Disbursement Flows

Two distinct flows share the same accountability mechanism (dual signature, warehouse attribution) but differ in trigger and frequency.

### Flow 1 — Job-Triggered Disbursement (Quick Win)

Triggered by a service call. Follows the full JAF Invoice state machine (see Quick Win Workflow below). Emergency jobs follow this same flow, triggered immediately upon receipt.

### Flow 2 — Van Restock Disbursement (Module 1)

Not tied to any specific job. Crew requests materials to keep the van stocked — happens 2–3 times per week.

1. Crew submits a `VanRestockRequest` in the app (items, quantities)
2. Warehouse receives the request, stages materials, signs as releaser
3. Crew arrives, confirms items, signs as receiver
4. Status transitions to FULFILLED — record is complete
5. Data flows into the consignment ledger (issued side)

No state machine beyond REQUESTED → FULFILLED. No supervisor approval needed.

---

## Quick Win Workflow (Weeks 1–4)

### Step 1 — Intake: Supervisor creates JAF Invoice

- Service call received → supervisor opens app and creates the JAF Invoice as the first act of intake
- Mobile form: job type, estimated address, Claro Aviso # (if already known), assigned crew, estimated service codes from catalog
- System generates `MAINT-YYMMDD-seq` control number
- The invoice IS the material request — Idalia receives in-app notification to begin staging

### Step 2 — Warehouse prep (conditional)

- Idalia sees invoice with estimated materials list, stages items, marks PREPPED
- **If crew already has sufficient materials in van → skip to Step 4.** Crew proceeds directly to field; no warehouse stop needed. The `CREATED → FIELD_UPDATED` transition is available to crew.

### Step 3 — Dual signature at warehouse pickup

- Crew arrives at one of the 3 zone warehouses (system records which warehouse)
- Crew reviews materials list on Idalia's tablet — adds any items not on estimated list
- **Warehouse person (Idalia or designee) signs first** — releasing materials
- **Crew member signs second** — confirming receipt
- Invoice transitions to SIGNED — `materials_taken` permanently locked
- Auto-generated warehouse receipt PDF: control #, materials, both signatures, warehouse, timestamp

### Step 4 — Crew updates from field

- Crew opens invoice on personal phone (PWA, works offline)
- Confirms or corrects job address
- Updates `materials_used` (≤ `materials_taken`) — reports what was actually consumed
- Uploads job-completion photos via camera
- Adds field notes, marks complete — supervisor notified
- System records materials left over (taken − used)

### Step 5 — Supervisor reviews and submits to Claro

- Supervisor sees the complete JAF Invoice:
  - **Photos** (inline, retrievable — source data for Claro submission)
  - Job address: estimated vs actual
  - Materials: taken / used / left-over variance
- **Claro submission helper:** pre-formatted display of every field the Claro portal requires (service codes, quantities, Aviso #, address, dates) — supervisor copies from this screen into Claro's portal, no reconstruction needed
- Supervisor creates work order in Claro portal using helper data
- Uploads resulting Claro work order PDF back into JAF Invoice
- Approves or sends back to crew with comment

### Step 6 — Lissette generates LC request

- Side-by-side view: JAF invoice data + embedded Claro PDF viewer
- Confirms match (or flags discrepancy back to supervisor)
- One click: system generates LC request PDF (Schedule of Accounts) using saved template
- Lissette emails to Hortencia Smith at PBCC — submission remains manual (email, no API)
- Once advance arrives: Lissette records `advance_received_at` + `advance_amount` in receivables dashboard
- Once final Claro payment arrives: records `final_payment_received_at` + `final_payment_amount`, closes entry

---

## Document Outputs

> **Numbering rule:** All numbering conventions and document format rules are derived from provided document samples. Patterns noted in this spec are approximations — verify each against samples before implementation. Return to Lissette only if a pattern cannot be determined from the samples.

The system generates all five documents in Lissette's current payment journey, eliminating FoxPro entirely.

### Document 1 — Warehouse Receipt (generated at Step 3 / crew signature)

- Control number + QR code
- Aviso number, job type, date, assigned crew, warehouse name
- Service codes + quantities signed out
- Warehouse release signature + releaser name
- Crew receiver signature + receiver name
- Timestamp

### Document 2A — Acta de Conformidad / JAF Invoice (generated after supervisor approval)

- Format matches current "Factura para el banco" template exactly — verify against sample
- Header: Numero Suplidor (V0000000006), Numero de Factura (M[year]-[aviso#] — verify), ORG (PWOR), Fecha
- Work description: job zone/address, work period (ENTRE dates), job type checkbox
- Line items: Claro service codes, descriptions, quantities (SR unit), unit price from catalog, importe, account codes (A/C, Sub Act, Dept, Profit Center, Act, Centro Codigo Costo)
- Summary ("Resumen") grouped by account code
- Total a Pagar with IVU — single fixed rate pulled from `system_settings.ivu_rate` (admin-configurable)
- Signature line
- Note: one job can link to multiple POs and generate multiple invoices

### Document 2B — Schedule of Accounts / LC Request (generated at Step 6)

- Submitted to: Pacific Business Capital Corporation (Hortencia Smith — hs@pbcc.com)
- Format: tabular list of invoices (Inv. Date, Invoice #, Debtor: PRT/CLARO, P.O. #, Invoice Amount — verify against sample)
- System calculates: Total, Advance (~80%), Adjustments, Cash Payment fields
- Signed by authorized agent (Monica)

### Document 3 — Production Journal / Payroll List (generated per person)

- Format matches current "JAF Communications, Inc. PRODUCTION JOURNAL" template — replicate exactly; do not simplify
- Generated for **each supervisor and each maintenance crew member** — Carmen uses this to pay maintenance staff via WinPay
- Per person: grouped by Aviso/M-number, service codes, descriptions, city, qty, net amount, **two retention columns** (replicate both as they appear in the sample; remove second column only if confirmed unnecessary in a later phase), adjusted net amount
- Sub-totals per aviso, grand total
- **Scope: maintenance crew/supervisors only.** Installation installer payment is handled separately — Carmen validates warranty issuance on Claro TOA and triggers payment from there (outside JAF scope, Module 2A adds structured entry form)
- Delivered to Carmen Lamboy (clamboy2@jafcom.net)

### Document 4 — PO from Claro (received, not generated)

- Claro issues PO after accepting work
- Supervisor uploads PO PDF into JAF Invoice; PO number linked via `po_links`

### Document 5 — Final Invoice for Claro Portal (generated last)

- "Factura de Pago - Claro" format — verify numbering against sample
- Header: Numero Suplidor, Numero de Factura, ORG (PWOR), Fecha
- Job zone and period (verify format against sample)
- Pedido table: Claro PO number(s), Acceptance numbers, Importe
- IVU: single fixed rate pulled from `system_settings.ivu_rate` — no state/municipal split
- Certification + approval signature lines
- Submitted manually to Claro portal by Lissette

---

## PWA & Offline Behavior

Crew field updates (Step 4) must work without internet.

- Workbox service worker caches the field update route
- Offline edits queued in IndexedDB
- Sync fires automatically when connection restores
- UI shows "Saved locally — syncing..." badge
- Conflict resolution: last-write-wins with full audit trail (crew edits are append-only)

---

## Phasing

### Week 1 — Foundation

- PostgreSQL schema (all tables, all modules)
- Auth + RBAC (5 roles)
- React Router v7 scaffold + PWA baseline
- Control number engine
- Service code catalog (admin-managed)
- System settings table + admin UI (IVU rate)
- 3-zone warehouse records seeded

### Weeks 2–3 — Intake → Warehouse

- Supervisor invoice creation form (mobile) — framed as intake
- Idalia's warehouse view + prep workflow
- Dual signature capture at pickup (SignaturePad.js — two sequential signatures)
- Warehouse attribution (which of 3 zone warehouses)
- Receipt PDF generation
- In-app notifications

### Week 4 — Field → LC Request + Quick Win Extras

- Crew field update form (offline-capable PWA) — including direct `CREATED → FIELD_UPDATED` path
- Photo upload + inline display in supervisor review
- Claro submission helper on supervisor review screen
- Supervisor review + Claro PDF upload
- Lissette's comparison view + LC request PDF generation
- **LC/Receivables aging dashboard** — Finance view, read + write, advance and final payment tracking, close entries
- **One-click audit package PDF** per control # — signatures, photos, issued vs used, full audit trail

**End of Week 4:** Full maintenance accountability loop closed.

### Weeks 5–6 — Module 1: Warehouse + Inventory

- Van restock request flow (crew requests, dual signature, warehouse fulfills)
- 3-zone warehouse management in UI
- Consignment ledger: admin logs Claro bulk deliveries + returns; system calculates issued/used/waste % continuously
- Waste % alert when approaching 10% audit threshold
- Idalia's full inventory dashboard
- IBS data migration (material disbursement records, see Open Items)

### Month 2 — Module 2A + Module 3

- Installation field ops (truck baseline, job consumption logging)
- Carmen's warranty validation entry form (logs TOA confirmation → generates full Production Journal including installation side)
- Lissette's unified reconciliation dashboard (Installation + Maintenance)
- Auto invoice generation
- Management analytics

---

## External Integrations

| System | Status | Approach |
|---|---|---|
| Claro portal | No API — mandatory | Supervisor copies from JAF submission helper into Claro's web portal. JAF displays all pre-filled data (service codes, quantities, prices, Aviso #) to eliminate reconstruction. Supervisor uploads resulting Aviso PDF + PO PDF back into JAF. |
| Claro TOA | External — read only | Carmen monitors for installer warranty issuance. No JAF integration. Module 2A adds a structured entry form so Carmen logs the TOA confirmation into JAF, enabling full Production Journal generation. |
| IBS | **Being replaced** | IBS performs 4 functions today: (a) material inventory → replaced by JAF inventory + consignment ledger (Module 1); (b) material disbursement record-keeping → replaced by JAF Invoice workflow (Quick Win); (c) Claro invoice creation → replaced by JAF PDF generation (Day 1); (d) van/installer material requests → replaced by Van Restock Request flow (Module 1). Data migration required before cutover (see Open Items). |
| WinPay 2000 | **Keep — future replacement planned** | Carmen pays maintenance supervisors and crew from approved bank credit. JAF generates the Production Journal PDF Carmen needs. She continues entering into WinPay manually. Future phase: payroll module inside JAF to replace WinPay entirely. |
| FoxPro | **Being replaced** | Currently generates all invoice formats. JAF replaces all of these with PDF generation from Day 1. No data migration needed — historical records stay in FoxPro for reference. |
| Pacific Business Capital Corp. | External — email | Lissette emails Schedule of Accounts to Hortencia Smith (hs@pbcc.com) for the 80% advance. JAF generates the PDF; submission remains email. |

---

## Security

- All routes protected by role-based session middleware
- Signatures stored as base64 in DB + rendered in PDFs (legally valid in PR under Law 167-2013)
- HTTPS enforced at deployment layer
- Photos stored in `/var/jaf/uploads/photos/`, served via Nginx with path-based access control (authenticated requests only)
- Audit trail is append-only — no record can be deleted
- 2FA for Finance and Admin roles (Lissette, Admin)

---

## Deployment Architecture (On-Premise)

```
Development
  └── Neon PostgreSQL (White Elephants instance) — shared hosted DB, dev/staging only

Production — On-Premise Server
  ├── Linux VM (primary)
  │   ├── Node.js app (React Router v7)    — serves PWA + API
  │   ├── PostgreSQL                        — primary database
  │   ├── /var/jaf/uploads                  — photo + PDF storage, served via Nginx
  │   └── Nginx (reverse proxy)             — SSL termination, static assets, file serving
  └── Windows VM (existing)
      └── WinPay 2000                       — Carmen's payroll, untouched
```

- **SSL:** Let's Encrypt (public IP) or self-signed cert for internal network
- **Backups:** PostgreSQL pg_dump + file snapshots to a second VM or external drive, daily automated
- **Access:** Public IP for field crew (PWA on phones); private network for warehouse and finance desktops

---

## Known Open Items

- **Service catalog seeding:** Claro contract service codes and prices must be imported before go-live. Obtain full contract rate sheet from management. Plan a CSV import tool or admin bulk-entry UI.
- **IBS data migration:** Scope which historical data needs migration — material disbursement records, installation job history. Confirm with client before Week 5 cutover.
- **WinPay format:** Confirm whether WinPay 2000 accepts CSV import so Carmen can skip manual re-entry. If not, Production Journal PDF is the deliverable.
- **Aviso number source:** Claro-assigned (e.g. 10333185). Supervisor enters it at intake if already known, or adds it after returning from Claro portal. It is the linking key for all downstream documents.
- **Multiple POs per job:** One Aviso can generate multiple Claro POs and multiple JAF invoices. `po_links` handles this. Lissette's Schedule of Accounts batches multiple invoices per submission — UI must make this clear.
- **Notification delivery:** In-app notifications confirmed. SMS optional — confirm with client for field crew alerts.
- **On-premise SSL:** Confirm with IT — Let's Encrypt (requires public domain) or internal CA cert.
- **Warehouse zones:** Confirm the 3 warehouse names and zone assignments before Module 1 build.
- **Consignment delivery process:** Confirm with management how Claro bulk material deliveries are documented on receipt (delivery slip, PO, verbal). Needed to design the consignment receipt entry form.
- **Carmen / TOA workflow:** Confirm exactly what data fields Carmen reads from TOA per installer warranty before designing the Module 2A entry form.
- **Document samples:** All numbering conventions and format rules must be extracted from provided samples before PDF implementation begins. Flag any pattern that cannot be determined from samples and return to Lissette only for those.
- **IVU rate:** Confirm current rate with management before go-live. Stored in `system_settings` — admin can update if regulations change.

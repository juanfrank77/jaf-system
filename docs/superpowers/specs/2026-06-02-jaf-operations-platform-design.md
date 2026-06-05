# JAF Unified Operations Platform — Design Spec

**Date:** 2026-06-02
**Status:** Approved for implementation planning

---

## Executive Summary

JAF Operations is bleeding profit through three broken handoffs: untracked material disbursement, unaccountable maintenance field operations, and manual multi-system invoicing. This system replaces those broken handoffs with a single traveling document (the JAF Invoice) that enforces accountability at every step — from supervisor request through warehouse pickup, field completion, Claro submission, and bank LC request.

**Quick win (Weeks 1–4):** Close the maintenance accountability loop entirely.
**Full system (Month 2):** Installation field ops + Lissette's invoicing dashboard.

---

## Problem Summary

- **Maintenance crew:** Supervisor calls Idalia verbally → materials leave warehouse with no receipt → supervisor guesses from memory days later → Lissette receives 3 conflicting material counts → reconciliation takes 60–120 days
- **Installation crew:** No consumption baseline → VP bypasses Idalia's authority → no accountability
- **Invoicing:** Same data entered 3–4 times across IBS, FoxPro, Excel, WINPAY → 7–180 day payment cycle
- **Root cause:** Supervisor has no system. No pre-approval, no tracking, no proof.

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
| Signatures | SignaturePad.js | Digital signature capture at warehouse |
| PDF generation | @react-pdf/renderer | LC request + receipt PDF generation |
| File storage | Local filesystem + Nginx | Photos served directly from on-premise server — no object storage needed |
| Dev database | Neon PostgreSQL | White Elephants shared Neon instance for development |
| Prod deployment | On-premise Linux VM | Client-provisioned server, dedicated VM, 1Gbps private network + public IP |

### Five-Layer Architecture

```
CLIENT LAYER (PWA)
  ├── Field App (mobile-first)     — Crew + Supervisors
  ├── Warehouse Desk (tablet)      — Idalia
  └── Finance Dashboard (desktop)  — Lissette / Management

API LAYER (RR7 loaders + actions)
  ├── Auth / RBAC
  ├── Control # Engine
  ├── JAF Invoice API
  ├── Signature capture
  └── PDF export

PROCESSING LAYER
  ├── Invoice state machine
  ├── Variance calculator (materials taken vs used)
  ├── LC request generator
  └── Audit logger

DATA LAYER (PostgreSQL + Prisma)

EXTERNAL (export-only)
  ├── Claro portal — PDF upload, manual work order entry
  └── Bank — LC request PDF submitted by Lissette
```

---

## Core Data Model

### JAF Control Document (central entity)

**Naming clarification:** The "JAF Invoice" is a control document — not a billing invoice. It's the internal job record that travels through the workflow enforcing accountability. The actual billing documents (Acta de Conformidad, Schedule of Accounts, Final Invoice for Claro) are generated from it, but the control document itself is an operational tracking record.

The control document has a strict state machine — fields lock at each step to prevent retroactive edits.

```
jaf_control_document
  id                    uuid PK
  control_number        string UNIQUE  (MAINT-YYMMDD-seq)
  status                enum (CREATED → PREPPED → SIGNED → FIELD_UPDATED → SUPERVISOR_APPROVED → CLARO_UPLOADED → LC_GENERATED)

  -- Supervisor fills (Step 2)
  job_type              string
  job_address_estimated string
  estimated_materials   jsonb          [{item, qty}]
  assigned_crew_ids     uuid[]
  supervisor_id         uuid FK
  created_at            timestamp

  -- Idalia marks (Step 3)
  prepped_at            timestamp
  prepped_by            uuid FK

  -- Crew signs at warehouse (Step 4) — LOCKS materials_taken
  materials_taken       jsonb          [{item, qty}]  -- crew confirms + adds to estimated list; locked at signature
  crew_signature        text           (base64)
  signed_at             timestamp
  signed_by             uuid FK

  -- Crew updates from field (Step 5)
  job_address_actual    string
  materials_used        jsonb          [{item, qty}]  -- must be ≤ materials_taken
  field_notes           text
  completed_at          timestamp

  -- Supervisor approves (Step 6)
  supervisor_approved_at    timestamp
  claro_pdf_path            string     (S3 key)
  claro_uploaded_at         timestamp

  -- Lissette (Step 7)
  lc_request_pdf_path   string
  lc_generated_at       timestamp
  lc_approved_by        uuid FK
```

### Supporting Tables

```
users               id, name, email, role, phone, active
audit_trail         id, invoice_id, user_id, action, diff_json, timestamp
photos              id, document_id, uploaded_by, local_path, taken_at
                    -- stored on-premise server, served via Nginx, internal proof of work only
                    -- NOT sent to Claro or any external system
service_catalog     id, claro_code, name, description, unit, unit_price, account_code,
                    sub_act, dept, profit_center, act, cost_center_code
                    -- Claro contract service codes with pricing (e.g. 34006428 @ $0.36/SR)
po_links            id, invoice_id, claro_po_number, acceptance_number, amount
                    -- one invoice can have multiple Claro POs
```

### Important: Service Codes vs Materials
Claro's system works on **service codes** (e.g. `34006428 REMOCION MENSAJERO`), not raw material names. The service catalog stores these codes with their contract unit prices. When supervisor creates a JAF Invoice, they select from this catalog — quantities and prices auto-populate. This is what drives the Acta de Conformidad, Production Journal, and Final Invoice formats.

### State Machine Rules

| Transition | Who triggers it | What locks |
|---|---|---|
| CREATED → PREPPED | Idalia marks ready | — |
| PREPPED → SIGNED | Crew signs at warehouse | `materials_taken` locked permanently |
| SIGNED → FIELD_UPDATED | Crew marks complete | `job_address_actual`, `materials_used`, photos added |
| FIELD_UPDATED → SUPERVISOR_APPROVED | Supervisor approves | — |
| SUPERVISOR_APPROVED → CLARO_UPLOADED | Supervisor uploads PDF | `claro_pdf_path` set |
| CLARO_UPLOADED → LC_GENERATED | Lissette approves match | `lc_request_pdf_path` generated |

`materials_used` must be ≤ `materials_taken` (enforced at API layer). Discrepancies require a note.

---

## Roles & Permissions

| Role | Access |
|---|---|
| **Supervisor** | Create/edit invoices (pre-sign), review crew updates, approve, upload Claro PDF, view own jobs |
| **Crew** | View assigned invoices, sign at warehouse, update field data (address, materials used, photos) |
| **Warehouse (Idalia)** | View all pending invoices, mark prepped, witness signing, view inventory status |
| **Finance (Lissette)** | View approved+uploaded invoices, compare JAF vs Claro PDF, generate LC requests |
| **Admin** | Full access, user management, materials catalog, audit trail |

Route-level protection enforced at the RR7 loader level — unauthorized access returns a redirect, not a 403.

---

## Quick Win Workflow (Weeks 2–4)

### Step-by-step

**Step 1 — Supervisor creates JAF Invoice**
- Mobile form: job type, address, estimated materials (from catalog dropdown), assigned crew
- System generates `MAINT-YYMMDD-seq` control number
- Idalia receives in-app notification + optional SMS

**Step 2 — Idalia preps at warehouse**
- Sees estimated materials list
- Stages materials, marks invoice as PREPPED
- No approval gate needed — prep is informational

**Step 3 — Crew signs at warehouse**
- Crew opens invoice on Idalia's tablet
- Reviews materials list — adds any additional items inline
- Signs with SignaturePad.js
- Invoice transitions to SIGNED — `materials_taken` permanently locked
- Auto-generated receipt (PDF or printable screen) shows: control #, materials, signature, timestamp

**Step 4 — Crew updates from field**
- Opens invoice on personal phone (PWA, works offline)
- Corrects job address, updates `materials_used` (≤ `materials_taken`)
- Uploads photos via camera
- Marks complete — supervisor notified

**Step 5 — Supervisor reviews and submits to Claro**
- Sees diff: original estimates vs crew actuals
- Approves or sends back with comment
- Manually creates work order in Claro portal (no API available)
- Uploads Claro work order PDF to JAF system

**Step 6 — Lissette generates LC request**
- Side-by-side view: JAF invoice data + embedded Claro PDF viewer
- Confirms match (or flags discrepancy back to supervisor)
- One click: system generates LC request PDF using saved template
- Replaces current manual format entirely

---

## Document Outputs

The system generates all five documents in Lissette's current payment journey, eliminating FoxPro entirely.

### Document 1 — Warehouse Receipt (generated at Step 3 / crew signature)
- Control number + QR code
- Aviso number, job type, date, assigned crew
- Service codes + quantities signed out
- Crew digital signature image
- Idalia confirmation

### Document 2A — Acta de Conformidad / JAF Invoice (generated after supervisor approval)
- Format matches current "Factura para el banco" template exactly
- Header: Numero Suplidor (V0000000006), Numero de Factura (M[year]-[aviso#]), ORG (PWOR), Fecha
- Work description: job zone/address, work period (ENTRE dates), job type checkbox (Instalación/Construcción/Mantenimiento)
- Line items: Claro service codes, descriptions, quantities (SR unit), unit price from catalog, importe, account codes (A/C, Sub Act, Dept, Profit Center, Act, Centro Codigo Costo)
- Summary ("Resumen") grouped by account code
- Total a Pagar with IVU breakdown
- Signature line
- **Linked to Claro Aviso/work order number (Orden Trabajo Planta)**
- **Note: one job can link to multiple POs and generate multiple invoices**

### Document 2B — Schedule of Accounts / LC Request (generated at Step 7)
- Submitted to: Pacific Business Capital Corporation (Hortencia Smith — hs@pbcc.com)
- Format: tabular list of invoices (Inv. Date, Invoice #, Debtor: PRT/CLARO, P.O. #, Invoice Amount)
- System calculates: Total, Advance (~80%), fields for Adjustments and Cash Payment
- Signed by authorized agent (Monica)
- Replaces current manual Excel/FoxPro assembly entirely

### Document 3 — Production Journal / Payroll List (generated per person)
- Format matches current "JAF Communications, Inc. PRODUCTION JOURNAL" template
- Generated for **each supervisor and each crew member** — Carmen uses this to pay everyone
- Per person: grouped by Aviso/M-number, service codes, descriptions, city, qty, net amount, 10% retention, adjusted net amount
- Sub-totals per aviso, grand total
- Payment flow: Lissette's LC request → bank approves credit → **Carmen uses approved credit to pay both supervisors and crew** via WinPay
- Delivered to Carmen Lamboy (clamboy2@jafcom.net) — currently submitted in paper; system generates PDF

### Document 4 — PO from Claro (received, not generated)
- Claro issues PO after accepting work (e.g. PO 4500510139)
- System receives/stores the PO PDF — supervisor uploads it
- PO number linked to the JAF Invoice for the Final Invoice step

### Document 5 — Final Invoice for Claro Portal (generated last)
- "Factura de Pago - Claro" format
- Header: Numero Suplidor, Numero de Factura (M[year]-XXXX), ORG (PWOR), Fecha
- Job zone and period (MANT-JAF-[month]-[year], ENTRE dates)
- Pedido table: Claro PO number(s), Acceptance numbers, Importe, IVU 11.5%, IVU 4%
- IVU tax split: 11.5% (state) + 4% (municipal), calculated automatically
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
- Materials catalog (admin-managed)

### Weeks 2–3 — Request → Warehouse
- Supervisor invoice creation form (mobile)
- Idalia's warehouse view + prep workflow
- Signature capture at pickup (SignaturePad.js)
- Receipt PDF generation
- In-app notifications (Idalia ← Supervisor, Supervisor ← Crew)

### Week 4 — Field → LC Request
- Crew field update form (offline-capable PWA)
- Photo upload (camera + S3)
- Supervisor review + Claro PDF upload
- Lissette's comparison view
- LC request PDF generation

**End of Week 4:** Full maintenance accountability loop closed.

### Weeks 5–6 — Module 1: Installation Disbursement
- Barbara's weekly installation material requests
- Consumption baseline display (last 4 weeks)
- Restock request + approval flow
- Idalia's full inventory dashboard

### Month 2 — Module 2A + Module 3
- Installation field ops (truck baseline, job consumption logging)
- Lissette's full reconciliation dashboard (Installation + Maintenance unified)
- Auto invoice generation (Claro billing + internal payroll)
- Management analytics

---

## External Integrations

| System | Status | Approach |
|---|---|---|
| Claro | No API — mandatory | Supervisor submits to Claro's web portal manually. JAF system provides all pre-filled data (service codes, quantities, prices) to minimize errors. Supervisor uploads resulting Aviso PDF + PO PDF back into JAF. |
| IBS | **Being replaced** | IBS handled installation request tracking. JAF system takes over this function from Week 5. Data migration from IBS to JAF PostgreSQL required before cutover. |
| WinPay 2000 | **Keep — future replacement planned** | Carmen (Carmen Lamboy) uses WinPay to pay both supervisors and crew from the approved bank credit. JAF system generates the Production Journal PDF Carmen needs. She continues entering into WinPay manually. Future phase: build a payroll module inside JAF to replace WinPay entirely. |
| FoxPro | **Being replaced** | Currently generates all invoice formats (Acta de Conformidad, Schedule of Accounts, Final Invoice). JAF system replaces all of these with PDF generation from Day 1. No data migration needed — historical records stay in FoxPro for reference. |
| Pacific Business Capital Corp. | External — email | Lissette emails Schedule of Accounts to Hortencia Smith (hs@pbcc.com) for the 80% advance. JAF system generates the Schedule of Accounts PDF; submission remains email. |

---

## Security

- All routes protected by role-based session middleware
- Signatures stored as base64 in DB + rendered in PDFs (legally valid in PR under Law 167-2013)
- HTTPS enforced at deployment layer
- Photos stored in private S3 bucket (presigned URLs for display)
- Audit trail is append-only — no record can be deleted
- 2FA for Finance and Admin roles (Lissette, Admin)

---

## Deployment Architecture (On-Premise)

Client provides dedicated server infrastructure — no cloud services required.

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
- **Backups:** PostgreSQL pg_dump + MinIO snapshots to a second VM or external drive, daily automated
- **Access:** Public IP for field crew (PWA on phones); private network for warehouse and finance desktops
- **Bandwidth:** 1Gbps more than sufficient — app traffic + photo uploads are negligible at JAF's scale

## Known Open Items

- **Service catalog seeding:** Claro contract service codes and prices (e.g. 34006428 @ $0.36/SR) must be imported before go-live. Obtain the full contract rate sheet from management. Plan a CSV import tool or admin bulk-entry UI.
- **IBS data migration:** What historical data from IBS needs to be migrated? Installation job history, material records? Scope with client before Week 5.
- **WinPay format:** Confirm whether WinPay 2000 has an import format (CSV, etc.) so Carmen can eventually skip manual re-entry. If not, the Production Journal PDF is the deliverable.
- **Aviso number source:** The Claro Aviso number (e.g. 10333185) is assigned by Claro's portal. Supervisor must enter it into the JAF Invoice when creating the job — it's the linking key for all downstream documents.
- **Multiple POs per job:** One Aviso can generate multiple Claro POs and multiple JAF invoices. The data model handles this via `po_links`, but the UI for Lissette must make this clear — the Schedule of Accounts batches multiple invoices per submission.
- **Notification delivery:** In-app notifications confirmed. SMS optional — confirm with client preference for field crew alerts.
- **On-premise SSL:** Confirm with IT whether to use Let's Encrypt (requires public domain) or internal CA cert.

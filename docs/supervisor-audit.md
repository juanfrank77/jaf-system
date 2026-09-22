# Supervisor audit: v5 mockup vs code (staging)

**Spec:** [`docs/mockups/v5/1. JAF_Supervisor_Dashboard_v5_19Sep.html`](mockups/v5/1.%20JAF_Supervisor_Dashboard_v5_19Sep.html) (`data-screen`: dash, new, review, match, invoices, precert, release, brigade).

**Rules:** [`DESIGN_SYSTEM_PORT.md`](DESIGN_SYSTEM_PORT.md), [`screen-rules-11.md`](screen-rules-11.md), [`GAPS.md`](GAPS.md), [`gap-reconciliation-53.md`](gap-reconciliation-53.md).

**Date:** 2026-09-22 · branch `supervisor-audit` · read-only (this file only).

---

## 1. Per-screen tables

Legend: **UI state** = v1 only / reverted chrome / DS port. Supervisor DS chrome was **reverted** ([`GAPS.md` § Reverted chrome-wrapper](GAPS.md#reverted-chrome-wrapper-screens-warehouse-crew-supervisor)); [`SupervisorReviewChrome`](../../app/components/design-system/screens.tsx) exists but is not wired.

### dash — Supervisor dashboard

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | [`/dashboard`](../../app/routes/_app.dashboard.tsx) → [`SupervisorDashboard`](../../app/components/supervisor-dashboard.tsx) when `role === "SUPERVISOR"` (`dashboard.tsx:236–237`, `455–463`). **No** separate `/supervisor` route. |
| **Fields / numbers / actions** | **Mockup:** 5 KPIs (open WOs, pending review, sent back, blocked Aviso≠invoice, released $), Today glance, review queue table, brigade bars, 8-step pipeline chart, Aviso & match list, invoices/pre-cert table, all-WOs table with step column + search. **Code:** Four queue cards only (`supervisor-dashboard.tsx:165–189`) — pending review, sent back, missing Aviso, blocked. KPIs, pipeline chart, brigade bars, combined tables, search: **missing**. Queue rows: `controlNumber`, address, brigade name, `SupervisorStage` label, invoice pre-IVU total (`dashboard.tsx:63–105`, `110–164`). Blocked = approved jobs where `|avisoLineTotal − jafInvoiceLineTotal| > tolerance` (`dashboard.tsx:153–162`). |
| **Business rules** | Supervisor scope by `supervisorId` on queues (`dashboard.tsx:47`, `114`, `134`). Sent-back = `SIGNED` + non-empty `sendBackHistory` (`dashboard.tsx:119–122`). **Not enforced:** area filter (“Central area” in mockup). |
| **UI state** | **v1 only** (shadcn `PageHeader`, `Card`, `Table`). |
| **Honest placeholders** | KPI strip + pipeline chart can ship with computed counts from existing loader data; brigade bar chart needs brigade aggregation query (schema has `Brigade.area`, `supervisorId`). |

### new — New work order

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | [`/docs/new`](../../app/routes/_app.docs.new.tsx) (`docs.new.tsx:31–49` loader, `157+` UI). |
| **Fields / numbers / actions** | **Mockup:** auto `JAF-2026-####`, optional Aviso, job-type **list**, address, description, catalog search with **610 vs 615** duplicate descriptions, line table with pinned catalog REV, brigade grid **filtered to supervisor area** (contractor name), material **kits**, pickup warehouse radio, create → warehouse + crew notified. **Code:** `controlNumber` via [`generateControlNumber`](../../app/lib/control-number.server.ts) → `MAINT-YYMMDD-###` (`control-number.server.ts:14–24`, `docs.new.tsx:89–97`). **No** Aviso field on create form (schema `avisoNumber?` exists — `schema.prisma:173` but unused here). `jobType` = free-text `Input` (`docs.new.tsx:191–195`), not lookup (#5). [`ServicePicker`](../../app/components/service-picker.tsx) search + duplicate-description hint (`service-picker.tsx:46–110`). [`MaterialLineItems`](../../app/components/material-line-items.tsx) free-form materials, **no kits**. **No** pickup warehouse field. Brigade select = **all** active brigades (`docs.new.tsx:35–38`), label includes area/code (`165–168`). |
| **Business rules** | Create requires jobType, address, brigadeId, service lines (`docs.new.tsx:81–83`). **Notifications:** warehouse only in same transaction (`docs.new.tsx:129–135`); **crew not notified** (gap #6). `supervisorId` set to creator (`docs.new.tsx:106`). |
| **UI state** | **v1 only**. |
| **Honest placeholders** | Read-only preview of next control number; optional Aviso input (nullable column exists); brigade list filtered client-side by `Brigade.supervisorId` or user area once PO defines rule. |

### review — Review field work (step 5)

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | [`/docs/:id/review`](../../app/routes/_app.docs.$id_.review.tsx) — single monolithic route for approve + later steps (`review.tsx:126–166` loader, `1368–1703` UI). **No** tabbed multi-job UI like mockup. |
| **Fields / numbers / actions** | **Mockup:** address diff (old→new, who/when/GPS), photos (≥1 before + after), ordered vs installed table, materials taken/used/back info, approve → generates invoice, send-back with note, qty variance “approve with variance”. **Code:** Estimated vs actual address as **separate lines**, not diff component (`review.tsx:1380–1392`); `addressCorrections` JSON on schema (`schema.prisma:217`) **not rendered**. Photos listed if any (`review.tsx:1438–1459`); gate requires BEFORE+AFTER (`supervisor-stage.ts:273–276`). [`ServiceLinesTable`](../../app/components/service-lines-table.tsx) ordered vs installed (`review.tsx:1403–1405`). Materials estimated/taken/used read-only (`review.tsx:1406–1437`). Approve intent (`review.tsx:176+`). Send-back appends `sendBackHistory`, sets `SIGNED` (`review.tsx:775–797`). **No** per-photo send-back (#23). **No** explicit “approve with variance” — supervisor approves installed lines as-is. |
| **Business rules** | Approve: `canTransition` → `SUPERVISOR_APPROVED` (`review.tsx:177`, `permissions.ts:32–35`). Send-back: note required (`review.tsx:776–777`). Photo gate for release, not for approve. **Loader does not verify** `doc.supervisorId === user.id` — any SUPERVISOR/ADMIN with doc id can act (`review.tsx:127–129`). |
| **UI state** | **v1 only** (+ vertical [`StepRail`](../../app/components/step-rail.tsx) at `review.tsx:1372`). Reverted chrome: [`SupervisorReviewChrome`](../../app/components/design-system/screens.tsx) unused. |
| **Honest placeholders** | Address diff from `addressCorrections` / estimated vs actual; qty mismatch chips from comparing `serviceLines` vs `installedServiceLines`; send-back reason (already works). |

### match — Aviso & match (step 7)

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | **No dedicated route.** Section C inside [`/docs/:id/review`](../../app/routes/_app.docs.$id_.review.tsx) (`review.tsx:1576–1628` UI, `345–487` `save_aviso` action). Dashboard links to review (`supervisor-dashboard.tsx:182–188`). |
| **Fields / numbers / actions** | **Mockup:** tabbed jobs, line-by-line Aviso vs invoice, amount hard block, qty mismatch flagged but flows with note, “adjust invoice with reason”, capture Aviso when missing, confirm match → step 8. **Code:** Aviso number, PDF, parsed lines stored on `JafInvoice` (`avisoNumber`, `avisoDocPath`, `avisoLines`, `avisoLineTotal`). [`checkAvisoMatch`](../../app/lib/supervisor-stage.ts) (`supervisor-stage.ts:195–232`). Amount mismatch → saves lines but **no** `avisoMatchedAt` (`review.tsx:430–441`). Qty mismatch with matching totals → requires `lineNote` (`review.tsx:401–405`). **No** “adjust invoice” mutation. Match success sets `avisoMatchedAt` + optional `CLARO_UPLOADED` (`review.tsx:444–455`). |
| **Business rules** | Amount mismatch: **UI + action block** on match stamp; release gate checks `avisoMatchedAt` (`supervisor-stage.ts:271`). **Not in** `canTransition` (#28). Qty mismatch: allowed with note when totals agree. |
| **UI state** | **v1 only** (section inside review page). |
| **Honest placeholders** | Line mismatch table + difference banner using existing `checkAvisoMatch` output; blocked state when `!amountOk`. |

### invoices — JAF invoices (step 6)

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | **No list route.** Generation: `generate_jaf_invoice` in [`review.tsx`](../../app/routes/_app.docs.$id_.review.tsx) (`256–342`). PDF path on doc. Mockup list + detail panel **missing**. |
| **Fields / numbers / actions** | **Mockup:** `INV-YYYY-####`, pre-IVU / IVU 11.5% / total columns, catalog REV pinned, finance sidebar (65%, 10% retention, paid to brigade). **Code:** Invoice number `M2026-${avisoNumber|controlNumber}` at generation (`review.tsx:289–291`) — not `INV-2026-####`. [`jafInvoiceLineTotal`](../../prisma/schema.prisma) = pre-IVU only (`schema.prisma:274`); IVU rate from [`getIvuRate()`](../../app/lib/system-settings.server.ts) applied in PDF only (`review.tsx:269`, `292–317`) — **not stored** on invoice (#29). `priceListRevision` on [`PreCertSheet`](../../prisma/schema.prisma) at precert gen (`review.tsx:506–517`); line prices snapshotted in `jafInvoiceLines` JSON. Contractor 65% / 10% retention computed in action, passed to PDF (`review.tsx:270–284`, `310–316`) — **not shown** in review UI sidebar. |
| **Business rules** | Requires installed lines (`review.tsx:265–266`). Sets `jafInvoiceGeneratedAt` (`review.tsx:330`). |
| **UI state** | **v1 only** (generate button + line sum on review). |
| **Honest placeholders** | Read-only invoice summary panel on review using stored lines + computed IVU from settings; list view can reuse dashboard approved queue. |

### precert — Pre-cert sheets

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | Section D in [`/docs/:id/review`](../../app/routes/_app.docs.$id_.review.tsx) (`1631–1648` UI; `490–726` actions). [`renderPreCert`](../../app/lib/pdf/pre-cert-sheet.server.tsx) for PDF. **No** monthly list route. |
| **Fields / numbers / actions** | **Mockup:** monthly list with signature counts (2/3, 3/3), print A4 light sheet, 3 sig slots (supervisor, sub, Claro optional). **Code:** [`PreCertSheet`](../../prisma/schema.prisma) with supervisor/sub/claro sig fields (`schema.prisma:374–392`). Claro optional for **release gate** (`evaluateReleaseGate` checks supervisor+sub only — `supervisor-stage.ts:278–281`; UI note at `review.tsx:1673`). Claro sign action exists (`review.tsx:678–725`). Finance queue **counts** Claro sig (`finance.queue.tsx:80`). Print = PDF download, not mockup HTML sheet. |
| **Business rules** | Generate requires `avisoMatchedAt` (`review.tsx:491–492`). Sub sign sets `contractorAccountCode` on doc (`review.tsx:657–659`). |
| **UI state** | **v1 only**. |
| **Honest placeholders** | Signature status chips (2/3) from sheet timestamps; link to PDF. |

### release — Release to Finance (step 8)

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | Section E in [`/docs/:id/review`](../../app/routes/_app.docs.$id_.review.tsx) (`1651–1698` UI; `728–772` `release_to_finance`). Post-release: [`/finance/queue`](../../app/routes/_app.finance.queue.tsx). |
| **Fields / numbers / actions** | **Mockup:** 7-item gate including **materials return reconciled by warehouse**; release button; released-this-month table with Finance status. **Code:** [`evaluateReleaseGate`](../../app/lib/supervisor-stage.ts) — 7 items: approved, invoice, aviso, amount_match, photos, precert_signed, **contractor_code** (`supervisor-stage.ts:261–283`). **No** returns-reconciled check. Release sets `releasedToFinanceAt`, notifies Finance (`review.tsx:750–771`). |
| **Business rules** | `gate.ok` required server-side (`review.tsx:734–738`). Button disabled when `!gate.ok` (UI). Amount match = `!!avisoMatchedAt` (proxy for amount OK). |
| **UI state** | **v1 only**. |
| **Honest placeholders** | Gate list UI already exists; add returns item when warehouse state is defined. |

### brigade — Brigade detail

| # | Topic | Finding |
|---|--------|---------|
| **Route / component** | **Missing.** Closest: brigade name on dashboard rows; [`/docs/new`](../../app/routes/_app.docs.new.tsx) picker; admin [`/admin/crews`](../../app/routes/_app.admin.crews.tsx). Mockup `data-go="brigade"` is **not implemented**. |
| **Fields / numbers / actions** | **Mockup:** open jobs table, KPIs (open, done YTD, sent back, invoiced YTD), contact/account, “+ WO for this brigade”, finance share hidden from supervisor. **Code:** `Brigade` model (`schema.prisma:442–459`); no supervisor-facing brigade dashboard. |
| **Business rules** | N/A — screen missing. |
| **UI state** | **Missing**. |
| **Honest placeholders** | Brigade header + open jobs list filtered by `brigadeId` + `supervisorId` (data exists). |

---

## 2. Specific checks (A–K)

### A. Release gate vs mockup 7 conditions

| Mockup condition | Code (`evaluateReleaseGate`) | Evidence |
|------------------|-------------------------------|----------|
| Reviewed and approved | `approved` ← `supervisorApprovedAt` | `supervisor-stage.ts:262` |
| JAF invoice generated | `invoice` ← `jafInvoiceGeneratedAt` | `supervisor-stage.ts:263` |
| Aviso captured | `aviso` ← number + path + lines | `supervisor-stage.ts:264–269` |
| Amount matches | `amount_match` ← `avisoMatchedAt` | `supervisor-stage.ts:271` |
| Pre-cert signed (supervisor + sub; Claro optional) | `precert_signed` ← both sigs; Claro **not** in gate | `supervisor-stage.ts:278–281`; Claro optional in UI `review.tsx:1673` |
| Before + after photos | `photos` ← BEFORE and AFTER tags | `supervisor-stage.ts:273–276` |
| Materials return reconciled by warehouse | **Missing** | Mockup `release` screen line 901 |

**Extra in code (not in mockup gate list):** `contractor_code` ← `contractorAccountCode` (`supervisor-stage.ts:282`).

**Stored “return reconciled” state?** **No dedicated flag.** Proxy data only:
- `JafInvoice.materialsReturned` JSON set by [`/docs/:id/returns`](../../app/routes/_app.docs.$id_.returns.tsx) action (`returns.tsx:137–148`, `schema.prisma:182`)
- Warehouse dashboard treats `materialsReturned: null` as “returns to log” (`dashboard.tsx:267`, `dashboard-stats.ts:301`)
- **Not** read by `evaluateReleaseGate`

**Why `contractor_code`?** Sub-contractor pre-cert sign copies `Brigade.code` (or typed code) onto `JafInvoice.contractorAccountCode` (`review.tsx:630–659`). Finance queue displays it (`finance.queue.tsx:77`). Release gate blocks until set — Carmen/payment routing needs contractor account on the packet.

### B. Aviso hard block (#28)

| Question | Answer | Evidence |
|----------|--------|----------|
| Can `avisoMatchedAt` be set when amounts differ? | **No** via `save_aviso` | `review.tsx:430–441` returns error, saves aviso fields without stamp |
| Can job be released with amount mismatch? | **No** — gate needs `avisoMatchedAt` | `supervisor-stage.ts:271`, `review.tsx:734–738`; tests `review.server.test.ts:809–909` |
| Is block in `canTransition`? | **No** | `permissions.ts:26–55` — status only |
| Adjust invoice with reason (mockup)? | **Not implemented** — no action to revise `jafInvoiceLines` after generation | Mockup `match` panel 725–726 |

**Bypass risk:** Direct DB edit only; no admin UI found to set `avisoMatchedAt` without match.

### C. Quantity mismatch on match

**Mockup:** qty mismatch flagged with note; job flows (`match` screen line 716, 741).

**Code:** [`checkAvisoMatch`](../../app/lib/supervisor-stage.ts) reports `lineMismatches` (`supervisor-stage.ts:223–227`). If **totals agree** but qty differs → `lineNote` required (`review.tsx:401–405`). If totals differ → amount block (B above). **Server-side enforced** on save; UI shows mismatches in action response.

### D. IVU 11.5% (#29) and catalog revision (#30)

| Item | Stored? | Where |
|------|---------|-------|
| IVU rate | Settings table via `getIvuRate()` | `system-settings.server.ts`; default 11.5% |
| IVU amount / total on invoice | **Computed at PDF gen only** | `review.tsx:269`, `jaf-invoice.server.tsx`; **not** columns on `JafInvoice` (#29) |
| Line prices pinned | **Yes** — `jafInvoiceLines` JSON + `jafInvoiceLineTotal` | `schema.prisma:273–274`, `review.tsx:328–329` |
| Catalog revision | `ServiceCode.priceListRevision`; copied to `PreCertSheet.priceListRevision` | `schema.prisma:340`, `379`; `review.tsx:506–517` |

### E. Number formats

| Label | Mockup | Code | Generator |
|-------|--------|------|-----------|
| Work order | `JAF-2026-####` | `MAINT-YYMMDD-###` | [`control-number.server.ts:14–24`](../../app/lib/control-number.server.ts), used `docs.new.tsx:89` |
| JAF invoice | `INV-2026-####` | `M2026-{aviso\|control}` | `review.tsx:289–291` |

Gap #2 in [`gap-reconciliation-53.md`](gap-reconciliation-53.md).

### F. New work order (mockup checklist)

| Mockup requirement | Status | Evidence |
|--------------------|--------|----------|
| Aviso optional at create | **Partial** — schema nullable; **form field missing** | `schema.prisma:173`; no field in `docs.new.tsx` |
| Job type controlled list | **Missing** — free string (#5) | `docs.new.tsx:191–195` |
| Code search, duplicate descriptions | **Built** | `ServicePicker` + `/api/service-codes` |
| Brigades filtered to supervisor area | **Missing** — all active brigades | `docs.new.tsx:35–38`; `Brigade.supervisorId` exists but unused in loader |
| Contractor name display | **Built** | `brigade.name` in labels |
| Material kits | **Missing** | `MaterialLineItems` only |
| Pickup warehouse | **Missing** | Not on create form |
| Warehouse + crew notified atomically (#6) | **Partial** — warehouse only | `docs.new.tsx:129–135`; no crew notification |

### G. Review (mockup checklist)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Address diff who/when/GPS | **Partial** — `addressCorrections` JSON; UI shows two address strings | `schema.prisma:217`, `review.tsx:1380–1392` |
| ≥1 before + ≥1 after photo | **Gate enforced** at release; not at approve | `supervisor-stage.ts:273–276` |
| Ordered vs installed per code | **Built** | `ServiceLinesTable` |
| Materials taken/used/back info | **Partial** — taken/used/estimated; **returns** on separate warehouse route | `review.tsx:1406–1437` |
| Approve → generates JAF invoice | **Separate step** — approve then manual generate invoice | `review.tsx:176+`, `256+` |
| Send back requires note | **Built** | `review.tsx:775–777` |
| Per-photo send-back (#23) | **Missing** | Job-level `sendBackHistory` only |

### H. Pre-cert

| Requirement | Status | Evidence |
|-------------|--------|----------|
| 3 signature slots | **Built** | supervisor / sub / claro actions |
| Claro optional, counted | **Built** — optional for gate; counted in finance queue | `supervisor-stage.ts:278–281`, `finance.queue.tsx:80` |
| Print A4 light / no chrome | **Partial** — PDF via `@react-pdf/renderer`, not mockup HTML print CSS | `pre-cert-sheet.server.tsx` |

### I. Step numbers — mockup (work in progress) vs `deriveGuideStep` (last reached)

**Mockup convention (in progress):** copy uses “Step N of 8” for the **work the role is doing now** — e.g. match screen = step 7 while invoice exists; confirm match → “step 8 ready” (`match` 716, 753). Dashboard table labels jobs at step 5 as “Your review” even when dollar amounts exist (mockup dash 556–557).

**Code convention (last reached):** [`deriveGuideStep`](../../app/lib/supervisor-stage.ts) (`supervisor-stage.ts:36–76`) — documented “default — pending product owner”.

| Job state (example) | Mockup step (WIP) | `deriveGuideStep` | `deriveSupervisorStage` (StepRail) |
|---------------------|-------------------|-------------------|-----------------------------------|
| `FIELD_UPDATED`, no invoice | 5 — Your review | **4** | APPROVE |
| `SUPERVISOR_APPROVED`, invoice generated | 6 — JAF invoice / or 7 waiting Aviso | **6** | INVOICE |
| Invoice + Aviso captured, not matched | 7 — Aviso match | **6** (no `avisoMatchedAt`) | AVISO |
| `avisoMatchedAt` set, not released | 7–8 (precert / release prep) | **7** | PRECERT or RELEASE |
| `releasedToFinanceAt` set | 8 — At Finance | **8** | RELEASED |

**Production UI today** uses **`deriveSupervisorStage` + StepRail** (9 stages), not `deriveGuideStep` (`review.tsx:149`, `1372`).

**Conflict:** Port docs say use `deriveGuideStep` for `.jaf-flow` ([`DESIGN_SYSTEM_PORT.md` §3](DESIGN_SYSTEM_PORT.md)); mockup tables read WIP; code StepRail uses 9-stage model. **Do not change code in this audit.**

### J. Permissions — other areas’ brigades/jobs

| Surface | Scoped? | Evidence |
|---------|---------|----------|
| Dashboard queues | **Yes** — `supervisorId: userId` | `dashboard.tsx:47`, `114`, `134` |
| `/docs/new` brigade list | **No** — all active brigades | `docs.new.tsx:35–38` |
| `/docs/:id/review` | **No ownership check** — any SUPERVISOR/ADMIN with id | `review.tsx:127–129`, `169–171` |
| `/docs/:id` doc view | LC lock only for Finance | `docs.$id.tsx` (not re-audited line-by-line) |
| `Brigade.area` / `Brigade.supervisorId` | **Schema only** — not used for supervisor filtering | `schema.prisma:446–448` |

**ADMIN** can see/act on all jobs by role.

### K. Finance info on invoice (65% / 10% / paid to brigade)

**Mockup:** read-only sidebar on invoices screen (`invoices` 831–838).

**Code:** Computed at **`generate_jaf_invoice`** only (`review.tsx:270–284`, `310–316`), embedded in **PDF** via [`generateJafInvoicePdf`](../../app/lib/jaf-invoice.server.tsx). **Not** persisted on `JafInvoice`. **Not** rendered in review v1 UI. Finance queue shows amounts/status, not brigade pay breakdown (`finance.queue.tsx`).

No shared “brigade pay preview” module for supervisor screens today.

---

## 3. Conflicts (mockup vs port docs vs code)

| # | Topic | Mockup | DESIGN_SYSTEM_PORT / GAPS | Code (staging) |
|---|--------|--------|---------------------------|----------------|
| 1 | **Supervisor screens** | 8 top-level screens + rich dash | Reverted chrome only; full DS port pending | Single `/dashboard` + `/docs/new` + monolithic `/docs/:id/review` v1 |
| 2 | **Step convention** | Work in progress (step 7 while matching) | `deriveGuideStep` = last reached (PO pending) | StepRail = 9 `SupervisorStage` values |
| 3 | **Release gate 7 items** | Includes warehouse returns reconciled | screen-rules #11: returns → gate item 7 | `contractor_code` instead of returns; no returns check |
| 4 | **WO number** | `JAF-2026-####` | gap #2 partial | `MAINT-YYMMDD-###` |
| 5 | **Invoice number** | `INV-2026-####` | (not specified) | `M2026-…` |
| 6 | **Approve → invoice** | One click generates invoice | (flow implied) | Two actions: approve, then generate |
| 7 | **Aviso hard block** | Hard block + adjust invoice path | #28 structural guard missing | Blocked in `save_aviso` + release gate, not `canTransition` |
| 8 | **Create notifications** | Warehouse + crew same moment | #6 structural | Warehouse only |
| 9 | **Brigade filter** | Supervisor area only | (not specified) | All brigades; dashboard by `supervisorId` on doc |
| 10 | **Claro pre-cert** | Optional, counted in KPIs | Claro badge visual only on gate | Optional for gate; finance counts sig |

---

## 4. Proposed PR sequence (supervisor base)

### (a) Backend / money-control first

| PR | Scope | Depends on | Risk |
|----|--------|------------|------|
| **S1** | **Aviso hard block in `canTransition`** — refuse `CLARO_UPLOADED` / release paths when totals mismatch (#28) | — | Low; closes bypass narrative |
| **S2** | **Release gate alignment** — add `returns_reconciled` (derived from `materialsReturned` + warehouse audit) **or** drop `contractor_code` from gate per PO; document Claro as visual-only | S1 optional | Medium; PO must pick gate list |
| **S3** | **Review ownership** — enforce `doc.supervisorId === user.id` (or brigade.area) on review action/loader | — | Medium; breaks cross-supervisor admin habits |
| **S4** | **Create WO notifications (#6)** — single transaction: warehouse + assigned crew notifications | — | Low |

### (b) Additive schema

| PR | Scope | Depends on | Risk |
|----|--------|------------|------|
| **S5** | **IVU + invoice metadata (#29)** — `ivuRate`, `ivuAmount`, `invoiceTotal` on `JafInvoice` at generation | — | Low |
| **S6** | **`JobType` lookup (#5)** + optional `pickupWarehouseId` on create | — | Medium |
| **S7** | **Per-photo send-back (#23)** — flag on `Photo` + send-back targets | — | Medium |
| **S8** | **Annual WO sequence (#2)** — optional; or document keeping MAINT format | PO | High if forced rename |

### (c) Screen ports (DS v2, flags)

| PR | Scope | Depends on | Risk |
|----|--------|------------|------|
| **S9** | **Supervisor dashboard v2** (`ENABLE_SUPERVISOR_DASH_V2`) — KPIs, queues, pipeline chart from loader aggregates | S3 if area filter | Medium |
| **S10** | **New WO v2** — mockup layout; brigade filter; optional Aviso; kits placeholder | S6 optional | Medium |
| **S11** | **Review v2 step 5** — address diff, photos, ordered/installed, materials info, send-back | S7 for photo send-back | High (largest screen) |
| **S12** | **Match + invoices v2** — tabbed or routed subviews; line match UI; invoice list | S1, S5 | High |
| **S13** | **Pre-cert + release v2** — gate UI, single source of truth, `.jaf-flow` via `deriveGuideStep` **after PO picks convention** | S2, step PO | High |
| **S14** | **Brigade detail v2** — new route `/brigades/:id` or dash drill-down | S9 | Low |

---

## 5. Product-owner questions only

1. **Step convention for supervisor UI:** work-in-progress (mockup) vs last-reached (`deriveGuideStep`) vs keep 9-stage StepRail?
2. **Release gate final 7:** mockup returns-reconciled **or** code `contractor_code` **or** both? Is Claro signature in or out of the gate?
3. **Aviso amount mismatch:** only wait for Claro corrected Aviso, or allow supervisor **invoice adjustment with audited reason** (mockup button)?
4. **Brigade scope:** filter by `Brigade.supervisorId`, by `area`, or all brigades for any supervisor?
5. **Work order / invoice number formats:** adopt mockup `JAF-YYYY-####` / `INV-YYYY-####` or keep MAINT / M2026?
6. **Approve + generate invoice:** single action (mockup) or keep two-step for audit?
7. **Supervisor sees brigade pay (65%/10%):** mockup invoices screen shows it; brigade screen says supervisor must not — which wins?

---

## Appendix — file index

| Area | Primary files |
|------|----------------|
| Dashboard | `app/routes/_app.dashboard.tsx`, `app/components/supervisor-dashboard.tsx` |
| New WO | `app/routes/_app.docs.new.tsx`, `app/lib/control-number.server.ts` |
| Review / match / invoice / precert / release | `app/routes/_app.docs.$id_.review.tsx` |
| Stage / gate / aviso math | `app/lib/supervisor-stage.ts` |
| Permissions | `app/lib/permissions.ts` |
| Returns | `app/routes/_app.docs.$id_.returns.tsx` |
| DS chrome (unused) | `app/components/design-system/screens.tsx`, `app/lib/features.server.ts` |
| Mockup | `docs/mockups/v5/1. JAF_Supervisor_Dashboard_v5_19Sep.html` |

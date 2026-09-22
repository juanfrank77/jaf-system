# Gap Register Reconciliation (53 Claims)

Full reconciliation of all 53 claims from the JAF Ops Design System Guide against the current schema.

**Legend:**
- **Satisfied** = Field/table exists, possibly under different name; map and move on
- **Additive** = New nullable column or table; ship UI first, backfill after
- **Structural** = New state machine, external integration, or architectural refactor; scope separately

---

## 1. Work Order & the Eight Steps (6 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 1 | Step 1-8 ordered enum, sortable | Ordered enum on work order | [`deriveGuideProgress`](../app/lib/supervisor-stage.ts) — WIP convention (decided 22 Sep); step 1 form-only; saved jobs start at 2 | **PARTIAL** - Derivation works for flow strip. **ADDITIVE**: persisted `derivedStep` for table sorts. |
| 2 | Auto work-order number `JAF-2026-####` | Server-side sequence per year | `JafInvoice.controlNumber` unique string | **PARTIAL** - [`generateControlNumber`](../app/lib/control-number.server.ts) emits `MAINT-YYMMDD-###` per day, not `JAF-YYYY-####` per year |
| 3 | Aviso optional at step 1, captured at step 7 | Nullable 8-digit field + capture timestamp + user | `avisoNumber?` nullable; `avisoMatchedAt?` timestamp exists; **NO** `avisoCapturedBy` user FK | **ADDITIVE** - Add `avisoCapturedById?`, `avisoCapturedAt?` |
| 4 | Estimated address + correction history (diff) | Two address fields + GPS + timestamp + user | `jobAddressEstimated`, `jobAddressActual`, `addressCorrections?` JSON, `gpsCoordinates?` | **SATISFIED** |
| 5 | Job type as controlled list | Lookup table | `JafInvoice.jobType` free `String` | **ADDITIVE** - Create `JobType` model; migrate string → FK |
| 6 | Warehouse + crew notified atomically | One transaction → two work items | Assignment logic in [`_app.docs.new.tsx`](../app/routes/_app.docs.new.tsx); `Notification` model exists | **STRUCTURAL** - Needs backend transaction guarantee across `JafInvoice` create + 2x `Notification` inserts |

---

## 2. Service Code Catalog (5 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 7 | 934 searchable codes by description | Searchable catalog, description primary index | `ServiceCode` table; admin catalog client-side filter on `name`/`claroCode` | **PARTIAL** - No `gin_trgm_ops` index on `ServiceCode.name` (trigram indexes exist on `JafInvoice` address/aviso only) |
| 8 | Dual account codes (610 vs 615) | Account as real attribute; duplicates legitimate | `ServiceCode.accountCode?` nullable; allows duplicates | **ADDITIVE** - Current schema allows it; UI must show both rows and let user choose (not dedupe) |
| 9 | Unit price to 4 decimal places `$42.3430` | `Decimal(12,4)` | `ServiceCode.unitPrice Decimal` (Prisma — precision unspecified in schema) | **STRUCTURAL** - Must verify DB column is `numeric(12,4)` or migrate |
| 10 | Catalog revision `REV 2023-04-21` versioned | Versioned price lists with effective dates | `ServiceCode.priceListRevision?` string, `effectiveFrom?` DateTime | **ADDITIVE** - Revision label exists; needs `PriceListRevision` entity as first-class object |
| 11 | Unit of measure `EA` | Unit field on code | `ServiceCode.unit?` nullable string | **SATISFIED** |

---

## 3. Materials & Inventory (7 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 12 | Separate SAP materials catalog (no prices) | Distinct table from service codes | `ServiceCode` with `kind: SERVICE\|MATERIAL` enum | **STRUCTURAL** - Guide wants two tables; app has one with discriminator. Splitting requires refactor of all material references. |
| 13 | Conversion factor `CAJAS · 1 = 100 PZA` | Conversion factor per code, nullable | **NONE** | **ADDITIVE** - Add `ServiceCode.conversionFactor?`, `conversionUnit?` |
| 14 | 39 codes have no factor → "unit not set" UI | Null case as rendered state | **NONE** — no `conversionFactor` column | **ADDITIVE** - Add `ServiceCode.conversionFactor?`; then render null as `.jaf-tag.warn` chip |
| 15 | Reorder minimum per code → "Below minimum" | Reorder point per code per warehouse | **NONE** | **ADDITIVE** - Create `StockLevel` model (`warehouseId`, `serviceCodeId`, `minimum`, `current`) |
| 16 | Serialized units (modems/ONTs) counted individually | Serial register + last-counted date | **NONE** | **ADDITIVE** - Create `SerialUnit` model (serial, `serviceCodeId`, `currentVanId?`, `lastCountedAt`, `claroAuditStatus?`) |
| 17 | Every movement has person + time | Append-only movement log | `VanInventoryTransaction` exists; **NO** warehouse-level log | **ADDITIVE** - Create `WarehouseTransaction` model (append-only, per-site) |
| 18 | Per-warehouse stock (Guaynabo vs Arecibo) | Stock per site, not global | `Warehouse` model exists; **NO** stock quantities | **ADDITIVE** - `StockLevel` (from #15) holds per-warehouse stock |

---

## 4. Pickup, Returns & Field Capture (7 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 19 | Dual signature locks pickup | Two signature records + names + timestamps + device | `releaseSignature`, `crewSignature` (base64) + `releasedById`, `signedById` + `releaseSignedAt`, `signedAt` | **PARTIAL** - Fields exist; [`_app.docs.$id_.sign.tsx`](../app/routes/_app.docs.$id_.sign.tsx) refuses overwrite when `materialsTaken` already set — not a DB immutability constraint |
| 20 | Over-pull allowed, captured, flagged amber | Taken qty stored alongside listed qty + reason | `materialsTaken` JSON; `buildOverages` vs `estimatedMaterials` | **PARTIAL** - Over-pull detected at sign; no separate persisted over-pull reason field |
| 21 | Taken → used → back quantities | Three quantities per material line | `materialsTaken`, `materialsUsed`, `materialsReturned` JSON blobs | **PARTIAL** - Three blobs on `JafInvoice`; return lines use `{ takenQty, returnedQty }` shape distinct from `{ serviceCodeId, qty }` |
| 22 | Before/after photos with timestamps | Photo storage + slug + capture time + WO link | `Photo` model (`docId` → `JafInvoice`, `localPath`, `takenAt`, `tag: BEFORE\|AFTER`) | **PARTIAL** - Work-order photos only; no `Photo`/`InstallLog` link for installer completions |
| 23 | Send-back requests specific photos, keeps rest | Partial rejection at evidence level | `sendBackHistory` JSON on `JafInvoice`; `Photo` has no per-item rejection flag | **ADDITIVE** - Add `Photo.sendBackRequested` boolean to flag specific photos |
| 24 | Installed qty ≠ ordered | Second quantity column on line | `serviceLines` vs `installedServiceLines` JSON | **SATISFIED** |
| 25 | Offline queue: "saved on phone, sends itself" | Client queue + retry + idempotent submission | [`offline-store.ts`](../app/lib/offline-store.ts) exists; idempotency needs server-side dedup key | **ADDITIVE** - Add submission dedup key (e.g. `clientSubmissionId` UUID) |

---

## 5. Invoicing, Pre-Cert & the Aviso Block (8 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 26 | JAF invoice generated, never keyed | Derived from approved installed lines (read-only) | `jafInvoiceLines` JSON generated; `jafInvoiceGeneratedAt` timestamp | **SATISFIED** |
| 27 | Pre-cert 3 signatures: supervisor, sub, Claro | Three signature slots, independent states | `PreCertSheet` model (`sigSupervisor*`, `sigSubcontractor*`, `sigClaro*` each with name/image/at) | **SATISFIED** |
| 28 | Amount mismatch hard blocks; qty flags | Two distinct rules + difference stored | `avisoLineTotal ≠ jafInvoiceLineTotal` logic in UI; **NO** backend guard | **STRUCTURAL** - Add transition guard in [`permissions.ts`](../app/lib/permissions.ts); job cannot reach step 8 if amounts mismatch |
| 29 | Invoice splits pre-IVU, IVU 11.5%, total | Tax as stored rated field | `jafInvoiceLineTotal` is pre-IVU; **NO** separate IVU/total columns | **STRUCTURAL** - Invoice-line schema change to store `ivuRate`, `ivuAmount`, `totalWithIvu` |
| 30 | Prices fixed at generation | Price snapshot per invoice line | `jafInvoiceLines` JSON includes `unitPrice` independent of live catalog | **SATISFIED** |
| 31 | Callback = no new Claro order, flat rate | Job type flag + flat-rate amount | **NONE** | **ADDITIVE** - Add `JafInvoice.isCallback` boolean, `callbackFlatRate?` Decimal |
| 32 | 7-item release gate | Checklist with 7 computed items + who/when | [`evaluateReleaseGate`](../app/lib/supervisor-stage.ts) — mockup order: approved, invoice, aviso, amount_match, photos, precert_signed, **returns_reconciled**. `contractor_code` is a separate prerequisite (pending PO). | **SATISFIED** (blocking) - Seven gate rows + prerequisite; `releaseOk` for mutations/buttons. **ADDITIVE** (attribution) - Add who/when per item: `ReleaseGate` model or JSON with `{ item, byUserId, at }` |
| 33 | Release → one packet (internal handoff) | Packet entity, not email | `releasedToFinanceAt` timestamp; **NO** packet entity | **ADDITIVE** - Create `FinancePacket` model (`jobId`, `documents[]`, `sentAt`, `receivedByLissetteAt`) |

---

## 6. Arm A · Runs, Retention, Installers (6 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 34 | Runs on 10th & 24th | Payment run entity + date + many lines | `PaymentRecord` per-job; **NO** `PaymentRun` entity | **STRUCTURAL** - Create `PaymentRun`; rewire `PaymentRecord` → FK runs |
| 35 | Brigade 65%, retention 10% with history | Configurable rates + history | Constants in code; **NO** rate entity | **STRUCTURAL** - Create `PaymentRate` model (`effectiveFrom`, `brigadeShare`, `retentionPct`) + FK from `PaymentRun` |
| 36 | Retention register for Hacienda | Retention accrued per run/contractor, exportable | **NONE** | **STRUCTURAL** - Create `RetentionAccrual` model (`runId`, `contractorId`, `amount`, `remittedAt?`, `exportPath?`) |
| 37 | ACH reference (WinPay external) | ACH reference field `20260912-JAF-015` | **NONE** | **ADDITIVE** - Add `PaymentRecord.achReference?` string |
| 38 | Carmen's check-off closes arm A | Per-line checked state visible to Lissette | **NONE** | **STRUCTURAL** - Add `PaymentRun.linesChecked` JSON or `PaymentRunLine` join table (`checkedAt?`, `checkedById?`) |
| 39 | Installer incomplete not payable | Completeness rule (serial + photos present) | `InstallLog` — no serial/photo/signature columns ([`schema.prisma`](../prisma/schema.prisma)); v2 wizard is 3-step and shows [`install_evidence_unavailable`](../resources/locales/en/common.json) only | **ADDITIVE** — completeness not computable. Proposed: `serialNumber?`, form-photo relation, `installerSignature?` + `signedAt?` before Carmen pay screens |

---

## 7. Arm B · Collections (4 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 40 | Days out from brigade-paid date | Brigade-paid date as ageing anchor | `PaymentRecord` has `date` per job; **NO** dedicated `brigadePaidAt` on `JafInvoice` | **STRUCTURAL** - Add `JafInvoice.brigadePaidAt?` (set when run closes arm A); collections pivot on this, not `avisoMatchedAt` |
| 41 | PO states: awaiting, short, Ariba, paid, closed short | State machine + short amount + reason | `PoLink` has `claroPONumber`, `amount?`; **NO** status enum | **STRUCTURAL** - Create `POStatus` enum; add `PoLink.status`, `shortAmount?`, `shortReason?` |
| 42 | Sold vs POs by month (float chart) | Both series aggregated by brigade-paid month | Chart in exec dashboard; query logic exists | **STRUCTURAL** - Depends on #40 (`brigadePaidAt` field) |
| 43 | "Avisos with no PO: 588, per 3 Sep review" | Point-in-time reconciliation with date | **NONE** | **STRUCTURAL** - Create `ReconciliationSnapshot` model (`asOfDate`, `avisoCount`, `poCount`, `notes`) — not a live count |

---

## 8. Cross-Cutting (6 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 44 | Spanish twin on every string | Translation layer | `remix-i18next` + i18n JSON keys | **PARTIAL** - Mechanism exists; many DS keys marked `[UNPROOFED]`; not every UI string has es twin yet |
| 45 | Theme persistence before first paint | Stored preference applied server-side | [`theme.server.ts`](../app/lib/theme.server.ts) cookie → [`root.tsx`](../app/root.tsx) applies `className="dark"` | **SATISFIED** - No flash; works correctly |
| 46 | Greeting sentence from KPI queries | Generated, must match tiles | Role dashboards use time-of-day greeting only ([`_app.dashboard.tsx`](../app/routes/_app.dashboard.tsx) `greetingFor`); installer v2 subtitle is loader-derived | **PARTIAL** — ported installer screens match KPI data; other dashboards still use time-of-day |
| 47 | Rail counts: red pill vs grey number | Per-user queue counts | `CountBadge` in DS shell; no `navCounts` loader wired | **ADDITIVE — not wired** (`CountBadge` ready, no `navCounts` loader) |
| 48 | `.ex` dotted figures = estimated | Unverified/estimated flag on metric | **NONE** | **ADDITIVE** - Add `MetricSnapshot.isEstimate` boolean or hardcode list of estimated metric keys |
| 49 | Names not roles: "Sent back by Edgard" | Actor names on every transition | Most transitions FK `User`; `sendBackHistory` stores `byUserId` | **PARTIAL** - Actor FKs exist; UI must resolve names from `User` — not rendered on every transition yet |

---

## 9. Installer Completions & Van Stock (4 claims)

| # | Claim | Needs to Exist As | Existing Field/Table | Verdict |
|---|-------|-------------------|---------------------|---------|
| 50 | Footage bracket table 250/500/750 FT | Bracket table mapping drop length → accessory qtys | **NONE** | **ADDITIVE** - Create `AccessoryBracket` model (`dropLengthFT`, `serviceCodeId`, `defaultQty`) |
| 51 | Two accessory lines have no SAP code → chip | Missing-code case as rendered state | `ServiceCode.claroCode String @unique` (NOT NULL) | **PARTIAL** - Schema requires `claroCode`; install v2 chip is defensive UI only until nullable/missing-code rows exist |
| 52 | Scanned serial → device + van | Serial lookup returning model + current holder | **NONE** | **ADDITIVE** - Depends on #16 (`SerialUnit` model); query by serial → device type + `currentVanId` |
| 53 | Van par levels + units owed back | Per-van stock + target + outstanding-returns count | `VanStockLevel` table + legacy `Van.standardStockLevels` JSON mirror | **PARTIAL** - Par levels canonical via [`getVanParLevels`](../app/lib/van-stock.server.ts); **units owed back** still blocked on #16 (`SerialUnit`) |

---

## Summary

| Verdict | Claims |
|---------|--------|
| **SATISFIED** | 4, 11, 24, 26, 27, 30, 32 (blocking), 45 |
| **PARTIAL** | 1, 2, 7, 19, 20, 21, 22, 44, 46, 49, 51, 53 |
| **ADDITIVE** | 1 (derivedStep getter), 3, 5, 8, 10, 13, 14, 15, 16, 17, 18, 23, 25, 31, 32 (attribution), 33, 37, 39, 47, 48, 50, 52 |
| **STRUCTURAL** | 6, 9, 12, 28, 29, 34, 35, 36, 38, 40, 41, 42, 43 |

**Quick wins:** `evaluateReleaseGate` blocking logic (claim #32); address diff fields on `JafInvoice` (#4)  
**Ship UI first, backfill schema:** Additive claims including #39 (InstallLog evidence), #14 (conversion factor), #1's `derivedStep` getter  
**Scope separately, do not block port:** Structural claims

---

## SATISFIED-claim audit (2026-09-22)

Independent verification of every claim previously marked **SATISFIED**:

| # | Claim | Verdict | Evidence | Corrected wording if not TRUE |
|---|-------|---------|----------|-------------------------------|
| 1 | Step 1-8 ordered enum | **PARTIAL** | `app/lib/supervisor-stage.ts` (`deriveGuideStep`) | Derived via `deriveGuideStep`; step 3 included; sort column still not persisted |
| 2 | Auto WO number | **PARTIAL** | `app/lib/control-number.server.ts:14-24` | Daily `MAINT-YYMMDD-###` sequence, not annual `JAF-YYYY-####` |
| 4 | Address + correction diff | **TRUE** | `prisma/schema.prisma:166-218` | — |
| 7 | Searchable 934-code catalog | **PARTIAL** | `app/routes/_app.admin.catalog.tsx:306-327` | Client filter; add trigram index on `ServiceCode.name` for scale |
| 11 | Unit of measure EA | **TRUE** | `prisma/schema.prisma:334` | — |
| 14 | Missing-factor UI | **FALSE** | No `conversionFactor` in schema | **ADDITIVE** — add column then chip |
| 19 | Dual signature locks pickup | **PARTIAL** | `app/routes/_app.docs.$id_.sign.tsx:185-189` | App refuses re-sign when `materialsTaken` set; not DB-enforced |
| 20 | Over-pull captured | **PARTIAL** | `app/routes/_app.docs.$id_.sign.tsx:78-90,220` | Detected at sign; no dedicated reason field |
| 21 | Taken/used/returned | **PARTIAL** | `prisma/schema.prisma:181-219`; `app/routes/_app.docs.$id_.returns.tsx:20-26` | Three JSON blobs; return shape differs |
| 22 | Before/after photos | **PARTIAL** | `prisma/schema.prisma:315-326` | `Photo.docId` → `JafInvoice` only |
| 24 | Installed ≠ ordered | **TRUE** | `prisma/schema.prisma:270-271` | — |
| 26 | Generated invoice | **TRUE** | `app/routes/_app.docs.$id_.review.tsx:328` | — |
| 27 | Pre-cert 3 signatures | **TRUE** | `prisma/schema.prisma:381-392` | — |
| 30 | Price snapshot | **TRUE** | `prisma/schema.prisma:273` | — |
| 32 | 7-item release gate | **TRUE** | `app/lib/supervisor-stage.ts` (`evaluateReleaseGate`) | Seven keys per v5 mockup; `contractor_code` prerequisite blocks via `releaseOk` |
| 39 | Installer completeness | **FALSE** | `prisma/schema.prisma:528-545` | **ADDITIVE** — InstallLog lacks serial/photo/signature |
| 44 | Spanish twin | **PARTIAL** | `app/localization/i18n.ts`; `resources/locales/es/common.json` | Mechanism only; coverage incomplete |
| 45 | Theme before paint | **TRUE** | `app/lib/theme.server.ts`; `app/root.tsx` | — |
| 46 | Greeting from KPIs | **PARTIAL** | `app/routes/_app.dashboard.tsx` | Already tracked |
| 47 | Rail counts | **ADDITIVE** | `docs/GAPS.md:119` | Already tracked |
| 49 | Actor names | **PARTIAL** | `prisma/schema.prisma:211-213` `sendBackHistory` | FKs exist; name rendering not universal |
| 51 | No SAP code chip | **PARTIAL** | `prisma/schema.prisma:330`; `installer-install.tsx:478` | `claroCode` NOT NULL; chip is defensive |
| 53 | Van par + owed back | **PARTIAL** | `prisma/schema.prisma:480-492`; `app/lib/van-stock.server.ts:59` | `VanStockLevel` canonical; owed-back needs #16 |

# Structural schema gaps

Inventory of gap-register claims that need their own workstream. Do **not** fold these into design-system screen ports. Presentation can ship with honest "not wired yet" cards.

Verdicts:

- **Additive** = nullable column or new table; UI can ship first.
- **Refactor** = state machine, split catalog, or rewiring existing money flows.

Recommended order is the sequence that unblocks ops screens without betting the live app on a rewrite.

| Claim | What | Verdict | Recommended order | Why this order |
|-------|------|---------|-------------------|----------------|
| 9 | `Decimal(12,4)` price precision | Refactor (verify then migrate) | 1 | Touches every money line; confirm before new finance entities. |
| 28 | Aviso amount hard-block in `canTransition` | Refactor (guard) | 2 | Money control. Backend must repeat the UI block. |
| 6 | Warehouse + crew notified in one transaction | Refactor | 3 | Create-WO integrity; small transaction wrap. |
| 16 | `SerialUnit` register | Additive | 4 | Unlocks installer scan + Claro serial audits. |
| 17 | `WarehouseTransaction` log | Additive | 5 | Stock honesty after serials. |
| 12 | Split SERVICE vs MATERIAL catalogs | Refactor | 6 | High blast radius; only after serial/stock models exist. |
| 29 | Store IVU rate / amount / total | Refactor | 7 | Invoice-line shape used by steps 6–8. |
| 32 | 7-item release gate persistence | Additive | 8 | Supervisor release UI already computes 7 checks. |
| 34 | `PaymentRun` entity | Refactor | 9 | Arm A spine. |
| 35 | `PaymentRate` history (65% / 10%) | Refactor | 10 | Depends on runs. |
| 38 | Carmen per-line check-off | Refactor | 11 | Must be one transaction across five surfaces. |
| 36 | `RetentionAccrual` + Hacienda export | Refactor | 12 | After check-off closes arm A. |
| 40 | `brigadePaidAt` ageing anchor | Refactor | 13 | Collections pivot. |
| 41 | PO state machine on `PoLink` | Refactor | 14 | Arm B states. |
| 42 | Sold vs POs chart by brigade-paid month | Refactor | 15 | Needs #40. |
| 43 | Point-in-time Aviso/PO snapshot | Additive | 16 | Reporting, not live ops. |

Related additive work that is **not** structural but still separate from a screen port: aviso capture user (#3), job-type lookup (#5), conversion factors (#13), `StockLevel` (#15/#18), photo send-back flag (#23), footage `AccessoryBracket` (#50), serial lookup (#52).

Claim #1 (ordered 1–8 step) is **satisfied via** `deriveSupervisorStage` + `supervisorStageToGuideStep`. Do not add a stored step enum.

## Claim #32 — what the 7-item release gate computes from today

There is **no `ReleaseGate` table**. [`evaluateReleaseGate`](../app/lib/supervisor-stage.ts) derives all seven items from live fields on `JafInvoice`, `PreCertSheet`, and `Photo`:

| # | Key | True when |
|---|-----|-----------|
| 1 | `approved` | `supervisorApprovedAt` set |
| 2 | `invoice` | `jafInvoiceGeneratedAt` set |
| 3 | `aviso` | `avisoNumber` + `avisoDocPath` + `avisoLines.length > 0` |
| 4 | `amount_match` | `avisoMatchedAt` set |
| 5 | `photos` | at least one `BEFORE` and one `AFTER` photo |
| 6 | `precert_signed` | supervisor + subcontractor signatures on the active sheet |
| 7 | `contractor_code` | `contractorAccountCode` set |

`ok` is `conditions.every`. The release mutation **repeats this check** and refuses `release_to_finance` when any item is false. The button is also `disabled={!gate.ok}`.

What the additive entity would add: who/when each item flipped, and persistence independent of those source fields.

**Claro field-acceptance badge:** When supervisor review is ported, the Claro badge should render as a `.jaf-note` below the seven gate rows. It is **visual only**, not part of `evaluateReleaseGate`, and does **not** block release.

---

## Reverted chrome-wrapper screens (warehouse, crew, supervisor)

Four doc routes were briefly wired with design-system **chrome wrappers** — a DS header (`.jaf-greet`, `.jaf-flow`, optional `.jaf-gate`) around the unchanged v1 form. They are **not ports** and have been **reverted** (route branches removed; flags off). Chrome components remain in [`app/components/design-system/screens.tsx`](../app/components/design-system/screens.tsx) for reuse on full rebuilds.

| Route | Flag (off) | Chrome component (kept) |
|-------|------------|-------------------------|
| `/docs/:id/prep` | `ENABLE_WAREHOUSE_V2` | `WarehousePrepChrome` |
| `/docs/:id/sign` | `ENABLE_WAREHOUSE_V2` | `WarehousePickupChrome` |
| `/docs/:id/field` | `ENABLE_CREW_V2` | `CrewFieldChrome` |
| `/docs/:id/review` | `ENABLE_SUPERVISOR_V2` | `SupervisorReviewChrome` |

`/docs/:id/returns` used the same wrapper pattern (`WarehouseReturnsChrome`); its route branch was removed with warehouse v2.

**Rebuild as full ports** per the blueprint: body markup in `.jaf-*` components inside `.jaf-ds`, not v1 forms wrapped in chrome.

**Defects to avoid on rebuild:**

1. **Hardcoded gate state** — `CrewFieldChrome` was passed `photosOk={false}` and `sigOk={false}`, so the crew submit gate could never go green. Gates must be computed from live form/loader data (photo count, signature pad state, etc.).
2. **Duplicate release gate** — Supervisor review showed `evaluateReleaseGate` in both `SupervisorReviewChrome` and the v1 release section (`<ul>` checklist). One source of truth only.
3. **Duplicate chrome** — Wrappers added DS back link + title while v1 `page` kept its own `BackLink`, `h1`, and (on review) vertical `StepRail` alongside horizontal `.jaf-flow`. Full ports replace v1 header/progress UI; they do not stack both.

**Real ports today:** installer dashboard (`ENABLE_INSTALLER_DASH_V2`), adjust/install/restock (`ENABLE_INSTALLER_V2`), restock pickup (v2 when flag on), DS app shell (`ENABLE_DS_SHELL`). See [DESIGN_SYSTEM_PORT.md § Installer ports](DESIGN_SYSTEM_PORT.md#installer-ports--built-status-verified-2026-09-22).

---

## Known debt: V1 empty states on ported screens

The following screens inherit v1 empty states (shadcn `<EmptyState>` component) and have not yet been ported to design-system empty-state patterns:

1. Installer dashboard (`_app.installer.tsx` v1 branch)
2. Installer adjust (`_app.installer.adjust.tsx` v1 branch when flag off)
3. Installer restock (`_app.installer.restock.tsx`)
4. Admin vans (`_app.admin.vans.tsx`)
5. Admin crews (`_app.admin.crews.tsx`)
6. Warehouse prep, sign, returns; crew field; supervisor review (reverted — not ported)

---

## Known debt: Admin dashboard filter shows CUID instead of supervisor name

The admin dashboard filter dropdown shows a raw CUID where a supervisor name should be. This is a separate ticket from screen ports. Add supervisor name resolution to the filter component.

---

## Known debt: App shell/rail (`ENABLE_DS_SHELL`)

Design-system shell (`DesignSystemAppShell`) ships behind `ENABLE_DS_SHELL` (requires `ENABLE_DESIGN_SYSTEM`). Flag off → v1 shell unchanged. Rail nav counts (gap #47) are not wired to the loader yet; counts render only when provided.

---

## Van stock — PR 1 landed, PR 2 route cutover landed

Additive migration: par levels live in `van_stock_level`; `Van.standardStockLevels` JSON kept as deprecated legacy mirror (dual-write on admin van create/update via [`setVanParLevels`](../app/lib/van-stock.server.ts)).

Route reads (`/installer`, `/installer/adjust`, `/installer/restock` action, `/admin/restock` loader, `/admin/vans` loader) use the van-stock module; dual-read fallback to JSON remains until a later cleanup PR.

**Par-status KPI (PR 2):** Wired on `/installer` v2 dashboard via [`computeParStatus`](../app/lib/van-stock.ts) — three states: no par levels set (neutral), all at par (ok), below-par count (warn).

**Units owed back KPI:** Still blocked on gap **#16 (`SerialUnit`)**. Guide “units owed back” means serialized units taken and not yet returned — not surplus above par. Do not approximate with `onHand - parLevel`.

**Pending restock on adjust:** `VanRestockRequest` has no `vanId`; pending restock is matched by `requestedById` (assumes one installer ↔ one van).

**Rail nav counts (gap #47):** **Additive — not wired.** `CountBadge` is ready; no `navCounts` loader yet — v2 renders counts only when provided.

**DS shell drawer breakpoint:** 1024px per guide (v1 used 768px). Viewports 769–1024px use the off-canvas drawer instead of the sidebar.

**Signature pad keyboard access:** Canvas signing remains pointer/touch-only on restock pickup (and other screens using `SignaturePad`). Keyboard-only capture is a separate accessibility track — not solved in the installer restock pickup port.

**Restock pickup signatures:** Restock pickup is single-signature (installer). Dual signature pending ops decision on whether pickups are attended; if yes, persist `releaseSignature` + signer and enforce both server-side (schema field already exists).

**Install completion wizard (`/installer/install` v2):** Three-step wizard (Info → Materials → Submit). Collects only fields the action persists. Footage bracket defaults (#50) and address diff (work-order fields) are not shown. Negative-stock blocking on install remains an ops decision — ledger may go negative and flags warehouse via `discrepancyFlagged`. No idempotency (#25) — double submit can duplicate logs.

### InstallLog has no completion evidence

- **`InstallLog` stores no serial, photo, or signature.** Current columns: `claroJobReference`, `serviceType`, `date`, `materialsUsed`, `notes`, `discrepancyFlagged` ([`schema.prisma`](../prisma/schema.prisma) `InstallLog`).
- The guide rule **"incomplete install is not payable"** cannot be enforced — completeness is not computable from persisted data.
- **Proposed additive change (before any Carmen installer-pay screen):** nullable `serialNumber` on `InstallLog`, a form-photo relation (or tagged `Photo` FK), and `installerSignature` + `signedAt`.
- v2 Submit shows a neutral note only; no serial/photo/signature inputs.

---

## Architecture wireframe gaps (3 Sep 2026)

Spec items from the 3 Sep architecture wireframe not yet in the gap register. Source: **wireframe 3 Sep**.

| Gap | What | Verdict |
|-----|------|---------|
| W1 | `ServiceCode.isSerialized` (+ serial count audit) | **Additive** — wireframe cites 19/278 serialized; no `isSerialized` column in [`schema.prisma`](../prisma/schema.prisma) today |
| W2 | Restock qty prefilled to par on `/installer/restock` | **Done** — v5 mockup: prefill = par − on van ([`computeRestockPrefillQty`](../app/lib/van-inventory.ts)); above-par lines → sign-off via [`countRestockLinesRequiringApproval`](../app/lib/van-inventory.ts) live note in [`InstallerRestockV2`](../app/components/design-system/installer-restock.tsx) |
| W3 | Dual-signature restock pickup (release + receiver) | **Additive** — wireframe scopes this to the warehouse counter pickup screen (same flow as crew sign-out step 3), not the installer [`/restock/:id/pickup`](../app/routes/_app.restock.$id_.pickup.tsx) screen; [`releaseSignature`](../prisma/schema.prisma) exists but unused |
| W4 | Adjust overdraw as persisted flag (amber, never red) | **Done** — overdraw flagged in warehouse notification message ([`_app.installer.adjust.tsx`](../app/routes/_app.installer.adjust.tsx) action); UI amber warning unchanged; transaction never blocked |
| W5 | Above-par restock sign-off role (wireframe: Monica) | **Partial** — [`evaluateRestockApproval`](../app/lib/van-inventory.ts) notifies **SUPERVISOR + ADMIN** today; Monica/CEO-specific routing not wired |
| W6 | `payablesClosedAt` per PO (Arm B closure) | **Additive** — not in schema; [`receivableClosedAt`](../prisma/schema.prisma) exists on `JafInvoice` only |
| W7 | `PaymentRequest` entity from installer submit | **Additive** — no model or route in repo |
| W8 | Carmen installer-pay completeness gate fed by install evidence | **Blocked on #39** — cannot compute complete/incomplete without persisted evidence |

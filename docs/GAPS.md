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

**Real ports today:** installer dashboard and installer task screens (`ENABLE_INSTALLER_DASH_V2`, `ENABLE_INSTALLER_V2`).

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

## Known debt: App shell/rail is still v1 on ported screens

The app shell (top bar + left rail) is still v1 on all ported screens. Porting the shell is a separate, deliberate step after more roles are done. Full v2 ports render body content with design-system primitives but inherit the v1 shell.

---

## Van stock — PR 1 landed (`VanStockLevel` table)

Additive migration: par levels live in `van_stock_level`; `Van.standardStockLevels` JSON kept as deprecated legacy mirror (dual-write starts in PR 2).

**Units owed back KPI:** Blocked on gap **#16 (`SerialUnit`)**. Guide “units owed back” means serialized units taken and not yet returned — not surplus above par. Do not approximate with `onHand - parLevel`.

**PR 2 — par-status KPI must expose three states:** [`computeParStatus`](../app/lib/van-stock.ts) returns `hasParLevels`, `belowParCount`, and `belowParLines`. A van with **no par rows** yields `hasParLevels: false` and `belowParCount: 0` — same numbers as “fully stocked.” The installer dashboard KPI must **not** treat that as green; wire a third UI state: **“No par levels set”** when `hasParLevels === false`.

# JAF Ops Design System Adoption Plan

## Investigation Summary

### 1. Class Collision Verdict: PREFIX REQUIRED

Zero CSS class collisions exist today — all design-system classes (`.box`, `.kpi`, `.pill`, etc.) live only in [JAF_Ops_Design_System_Guide.html](../JAF_Ops_Design_System_Guide.html). The React app uses Tailwind utilities exclusively.

However: Landing the guide stylesheet globally creates HIGH-RISK conflicts:

| Class | Conflict type | Impact |
|-------|--------------|--------|
| `grid`, `top`, `sm`, `wrap`, `screen` | Tailwind utility namespace pollution | Will confuse or break Tailwind's `grid`, `top-*`, `sm:*`, `flex-wrap`, `*-screen` patterns |
| `pill`, `stat`, `tabs`, `flow`, `rail` | Semantic overlap with React components | App already has `<Pill>`, `<Stat>`, `<Tabs>`, `<StepRail>` with different markup/meaning |
| `tag`, `inp`, `chk`, `box` | Component library overlap | App uses shadcn/ui Badge, Input, Checkbox, Card |
| `field` | Domain vocabulary | Route `/docs/:id/field` means "field work", not a form layout class |

**Consequence:** Ship the design system prefixed or scoped. Options:

**A. Namespace prefix (recommended):** `.jaf-box`, `.jaf-kpi`, `.jaf-pill`, etc.
- Pros: Clean separation; no surprises; guide snippets work with one scripted rename
- Cons: Verbose class names; prefix appears everywhere

**B. Scope under wrapper class:** `.design-system .box { … }`
- Pros: Keeps short class names inside ported screens
- Cons: Specificity fights; must wrap every ported screen; dark-mode selectors get complex

**Recommendation:** Namespace with `.jaf-` prefix. One pass with sed or an editor macro transforms the guide CSS, and every subsequent screen port uses the transformed classes with no ambiguity.

---

### 2. Stack Reality: React + Tailwind (moderate fit)

**Current:** React Router v7.16 + Vite + Tailwind CSS v4 + shadcn/ui + i18next

This maps to two rows in the guide's "Frameworks" table:

| Stack | Take kernel CSS | Take kernel JS | Reality |
|-------|----------------|----------------|---------|
| React / Vue | ✓ verbatim | ⚠ partly | Keep theme, i18n, rings, sparks, charts. Replace router (`data-go` → React Router Links), tabs/filter (→ component state), gating (→ form state). Do not fight over `data-flip` DOM replacement. |
| Tailwind in place | ⚠ as a layer | ✓ verbatim | Put design tokens in `tailwind.config` so utilities and components share one palette. Do not re-express components as utility strings — they drift. |

**Shape of the port:**

1. Extract design tokens from guide CSS (`:root { --plane, --ink, … }`) → `app.css` `@theme` block
2. Add guide component CSS (`.jaf-box`, `.jaf-kpi`, …) as a separate layer or imported sheet
3. Keep guide JS for: theme toggle, i18n (`data-es`), SVG rings/sparks, chart hover, toast
4. Replace guide JS for: `data-go` navigation (→ `<Link to>`), `data-tab` (→ React state), `data-filter` (→ controlled inputs)
5. Build new React components that render guide markup with React props, not pure HTML strings

**Example:**

```tsx
// New component: app/components/design-system/KPI.tsx
export function KPI({ label, value, delta, variant, viz }: KPIProps) {
  return (
    <div className="jaf-kpi">
      <div>
        <div className="jaf-l">{label}</div>
        <div className={cn("jaf-v", variant && `jaf-${variant}`)}>{value}</div>
        {delta && <div className="jaf-d">{delta}</div>}
      </div>
      {viz && <div className="jaf-viz">{viz}</div>}
    </div>
  )
}
```

---

### 3. Work Order State Model: HIGHEST RISK — PARTIAL MAPPING

**The guide expects:** An ordered enum, steps 1–8, sortable, with every screen agreeing on the number.

**Guide's 8-step labels** (from `.flow` strip in § Flows):

> 1 Created · 2 Warehouse prep · 3 Crew signs out · 4 Field work · 5 You review · 6 JAF invoice · 7 Aviso matched · 8 To Finance

**Reality:** There is no `WorkOrder` model. Jobs are `JafInvoice` with:

- `DocStatus` enum (7 forward states + CANCELLED): `CREATED` → `PREPPED` → `SIGNED` → `FIELD_UPDATED` → `SUPERVISOR_APPROVED` → `CLARO_UPLOADED` → `LC_REQUEST_GENERATED`
- Steps 6–8 are **timestamp-driven**, not enum values: `jafInvoiceGeneratedAt`, `avisoMatchedAt`, `releasedToFinanceAt`
- Derived stage logic in [`app/lib/supervisor-stage.ts`](../app/lib/supervisor-stage.ts) computes 9 `SupervisorStage` values from `status` + nullable timestamps

**Mapping to the guide's 8 steps:**

| Guide step | Guide label | Schema reality | Fit |
|------------|-------------|----------------|-----|
| 1 | Created | `CREATED` | ✓ Clean |
| 2 | Warehouse prep | `PREPPED` (+ `preppedAt`) | ✓ Clean — labels match |
| 3 | Crew signs out | `SIGNED` (+ dual sigs) | ✓ Clean |
| 4 | Field work | `SIGNED` → `FIELD_UPDATED` | ⚠ Ambiguous — "in field" vs "submitted" are two DocStatus values for one guide step |
| 5 | You review | `FIELD_UPDATED` → `SUPERVISOR_APPROVED` | ✓ Clean |
| 6 | JAF invoice | `jafInvoiceGeneratedAt` timestamp (status stays `SUPERVISOR_APPROVED`) | ✗ Not in enum — invoice generation is a timestamp, not a status transition |
| 7 | Aviso matched | `avisoMatchedAt` timestamp (often → `CLARO_UPLOADED`) | ⚠ Partial — Aviso match is a timestamp; `deriveSupervisorStage` computes separate AVISO and PRECERT stages (7a, 7b) |
| 8 | To Finance | `releasedToFinanceAt` timestamp (status often still `CLARO_UPLOADED`) | ✗ Not in enum — release is a timestamp |

**Root cause:** The schema grew organically — early work fit a 5-step enum (`CREATED` … `SUPERVISOR_APPROVED`), then supervisor/finance complexity was added as timestamps rather than splitting the enum further. Steps 6–8 are timestamp gates, not first-class statuses.

**Consequences for the port:**

- The guide's `.jaf-flow` strip (steps 1–8 as pills) cannot render directly from `DocStatus` — it must call `deriveSupervisorStage` or equivalent logic that reads `status` + timestamps
- Tables that want to sort "by step" need a computed step column, not a direct `DocStatus` enum sort
- Steps 6–8 rendering requires checking nullable timestamps — a job at `SUPERVISOR_APPROVED` may be at step 5, 6, 7, or 8 depending on which timestamps are set

**Recommended resolution:**

**Do NOT:** Add a stored `step` integer field or rename `DocStatus` values — the schema is stable and correct for the domain.

**DO:**

1. Use `deriveSupervisorStage` (or equivalent) as the source of truth for rendering `.jaf-flow` strips and computing step numbers. This function already encodes the timestamp logic:

   ```ts
   // Simplified logic (see app/lib/supervisor-stage.ts for full version)
   if (!jafInvoiceGeneratedAt) return step 5 (SUPERVISOR_APPROVED)
   if (!avisoMatchedAt) return step 6 (INVOICE)
   if (!preCertAllSigned) return step 7 (AVISO → PRECERT)
   if (!releasedToFinanceAt) return step 7.5 (PRECERT → RELEASE)
   return step 8 (RELEASED)
   ```

2. Render `.jaf-flow` strips dynamically with step numbers 1–8 derived from `deriveSupervisorStage`:

   ```tsx
   const currentStep = deriveSupervisorStage(invoice)
   const stepNumber = STAGE_TO_STEP_MAP[currentStep] // e.g. AVISO → 7
   <FlowStrip steps={8} current={stepNumber} you={roleSteps[currentRole]} />
   ```

3. Use guide's step labels for the `.jaf-flow` strip (Created, Warehouse prep, Crew signs out, Field work, You review, JAF invoice, Aviso matched, To Finance) — these are UI conventions, not schema labels. The app's `DocStatus` labels (CREATED, PREPPED, etc.) remain in code/logs.

4. Document the mapping in [`supervisor-stage.ts`](../app/lib/supervisor-stage.ts) header comment:

   ```ts
   /**
    * Guide's 8-step model maps to app state as follows:
    * Steps 1-5: DocStatus enum values (CREATED → SUPERVISOR_APPROVED)
    * Steps 6-8: Computed from timestamps (jafInvoiceGeneratedAt, avisoMatchedAt, releasedToFinanceAt)
    * 
    * This function returns 9 stages (splits step 7 into AVISO + PRECERT) to handle
    * the Aviso match → PreCert sign → Release sequence. UI collapses these back to
    * 8 steps for the .jaf-flow strip.
    */
   ```

5. For sorting: Add a computed `derivedStep` getter on `JafInvoice` that calls `deriveSupervisorStage` → step number. Use this for table sorts, not raw `DocStatus`.

---

### 4. Gap Register Reconciliation (53 claims → verdict for each)

Full 53-row reconciliation: [gap-reconciliation-53.md](gap-reconciliation-53.md)

**Grouped summary:**

#### Already Satisfied (verified 2026-09-22)

| Claim # | What | Existing field/table |
|---------|------|---------------------|
| 4 | Estimated address + correction history | `jobAddressEstimated`, `jobAddressActual`, `addressCorrections`, `gpsCoordinates` |
| 11 | Unit of measure | `ServiceCode.unit` |
| 24 | Installed ≠ ordered quantities | `serviceLines` vs `installedServiceLines` JSON |
| 26 | Generated invoice (read-only) | `jafInvoiceLines` JSON (snapshot at generation) |
| 27 | Pre-cert 3 signatures | `PreCertSheet` (`sigSupervisor*`, `sigSubcontractor*`, `sigClaro*`) |
| 30 | Price snapshot at invoice time | `jafInvoiceLines` includes `unitPrice` independent of live catalog |
| 32 (blocking) | 7-item release gate | [`evaluateReleaseGate`](../app/lib/supervisor-stage.ts) — seven keys match docs |
| 45 | Theme persistence | `theme.server.ts` cookie → [`root.tsx`](../app/root.tsx) `Layout` sets `html.dark` before paint ✓ |

#### Partial (schema or UI gap remains)

| Claim # | What | Gap |
|---------|------|-----|
| 1 | Step 1-8 enum | Derived via `deriveSupervisorStage`; no persisted sort column; step 3 omitted in mapping |
| 2 | Auto work-order number | `MAINT-YYMMDD-###` not `JAF-YYYY-####` |
| 7 | Searchable catalog | Client filter; no trigram on `ServiceCode.name` |
| 19–22 | Pickup / field capture | Fields exist on `JafInvoice`; immutability/Photo scope partial — see [gap-reconciliation-53.md](gap-reconciliation-53.md) audit |
| 44 | Spanish i18n | Mechanism only; coverage incomplete |
| 46 | Greeting from KPIs | Installer v2 loader-derived; other dashboards time-of-day |
| 49 | Actor names | User FKs exist; not rendered on every transition |
| 51 | Missing SAP chip | `claroCode` NOT NULL in schema; chip defensive only |
| 53 | Van par levels | `VanStockLevel` canonical; units owed back blocked #16 |

#### Additive (nullable columns or new tables, ship UI first)

| Claim # | What | Additive action |
|---------|------|----------------|
| 3 | Aviso capture timestamp + user | Add `avisoCapturedAt?`, `avisoCapturedById?` to `JafInvoice` |
| 5 | Job type lookup table | Create `JobType` model; migrate free string → FK |
| 8 | Dual account codes (610 vs 615) | Allow duplicate `claroCode` rows with different `accountCode`; UI shows both |
| 10 | Catalog revision as entity | Create `PriceListRevision` model; FK from `ServiceCode.revisionId` |
| 13, 14 | Conversion factors + missing-factor UI | Add `ServiceCode.conversionFactor?`, `conversionUnit?`; then render null as chip |
| 39 | InstallLog completion evidence | Add `serialNumber?`, form-photo relation, `installerSignature?` + `signedAt?` before Carmen pay screens |
| 15 | Reorder minimum per warehouse | Add `StockLevel` model (`warehouseId`, `serviceCodeId`, `minimum`, `current`) |
| 16 | Serialized unit register | Create `SerialUnit` model (`serial`, `serviceCodeId`, `currentVanId?`, `lastCountedAt`) |
| 17 | Warehouse movement log | Create `WarehouseTransaction` model (append-only) |
| 18 | Per-warehouse stock | `StockLevel` (from #15) |
| 23 | Partial photo send-back | Add `Photo.sendBackRequested` boolean; `sendBackHistory` already JSON on `JafInvoice` |
| 25 | Offline queue | Client-side (`offline-store.ts` exists); idempotency needs server-side dedup key |
| 31 | Callback flag + flat rate | Add `JafInvoice.isCallback` boolean, `callbackFlatRate?` |
| 32 (attribution) | 7-item release gate attribution | Add who/when per item: `ReleaseGate` model or JSON with `{ item, byUserId, at }` |
| 33 | Packet handoff entity | Create `FinancePacket` model (`jobId`, `documents[]`, `sentToFinanceAt`, `lissetteReceivedAt`) |
| 37 | ACH reference field | Add `PaymentRecord.achReference?` (WinPay external ref) |
| 48 | Estimated-figure flag | Add `MetricSnapshot.isEstimate` boolean (or render `.jaf-ex` from hardcoded list) |
| 50 | Footage bracket table | Create `AccessoryBracket` model (`dropLengthFT`, material, `defaultQty`) |
| 52 | Serial → device/van lookup | Query `SerialUnit` (from #16) |

#### Structural (state machines, integrations, architectural)

| Claim # | What | Why structural |
|---------|------|----------------|
| 6 | Warehouse + crew notified atomically | Dual-rail notification system; transaction spans `Notification` writes for two users. Backend work. |
| 9 | `Decimal(12,4)` price precision | Prisma schema declares `Decimal` with no explicit scale; must verify DB column is `numeric(12,4)` or migrate. |
| 12 | Separate SAP materials catalog | Guide wants two tables (SERVICE vs MATERIAL); app has one `ServiceCode` with `kind` enum. Splitting is a major refactor. |
| 28 | Aviso amount hard block | Business rule: job cannot reach step 8 if `avisoLineTotal` ≠ `jafInvoiceLineTotal`. Needs state-machine guard in transitions. |
| 29 | IVU as stored rated field | `jafInvoiceLineTotal` is pre-IVU; IVU and total are not stored separately (computed at render). Adding them needs invoice-line schema change. |
| 34 | Payment run entity | Create `PaymentRun` model (date, `lines[]`, `sentToCarmenAt`); rewire `PaymentRecord` to FK runs instead of direct `jobId`. |
| 35 | Brigade 65% / retention 10% with history | Add `PaymentRate` model (`effectiveFrom`, `brigadeShare`, `retentionPct`) + FK from `PaymentRun`. |
| 36 | Retention register for Hacienda | Create `RetentionAccrual` model (`runId`, `contractorId`, `amount`, `remittedAt?`, `exportPath?`) |
| 38 | Carmen per-line check-off | Add `PaymentRun.linesChecked` JSON or `PaymentRunLine` join table with `checkedAt?`, `checkedById?` |
| 40 | Brigade-paid date as ageing anchor | Add `JafInvoice.brigadePaidAt?` (set when run closes arm A); collections chart pivots on this, not `avisoMatchedAt`. |
| 41 | PO state machine | Create `POStatus` enum (AWAITING, SHORT, ARIBA, PAID, CLOSED_SHORT); add to `PoLink` + `shortAmount?`, `shortReason?`. |
| 42 | Sold vs POs chart | Query aggregating by `brigadePaidAt` month; needs #40. |
| 43 | Point-in-time Aviso/PO reconciliation | Create `ReconciliationSnapshot` model (`asOfDate`, `avisoCount`, `poCount`, `notes`) — not a live count. |

---

### 5. Screen Inventory: Mapping to Guide Roles

**Current:** ~35 screens exist. **Guide:** 51 screens across 7 roles.

**Coverage by role:**

| Role | Guide screens | App screens | Status |
|------|---------------|-------------|--------|
| Monica (CEO) | 1 (command center) | Partial (`/dashboard` exec panels for ADMIN/FINANCE) | Missing: dedicated CEO role, 4 reports (exposure, field, payroll, inventory audit) |
| Edgard (Supervisor) | 8 | 5 (dash, new, edit, review, audit-package) | Missing: match, invoices, precert, release, brigade |
| Frank (Warehouse) | 9 | 4 (dash, prep, sign, returns, restock-fulfill) | Missing: inventory, requests, serials, log, wh |
| Jesús (Crew) | 8 | 3 (dash, sign, field) | Missing: sentback, payments, history, super, wh |
| Lissette (Finance) | 9 | 5 (dash, queue, verify, pbcc, po, receivables) | Missing: lists (build run), awaiting (Carmen's ✓), ariba, dedicated short/claro |
| Carmen (Comptroller) | 8 | 2 (dash, job detail — flagged) | Missing: inbox, runs (WinPay), paid, retention, installers, claro, hacienda |
| Installer | 8 | 4 (dash, install, adjust, restock + pickup) | Missing: swap, payments, history, super, wh (full van UX) |

**App has / guide doesn't:**
- `/account` (user profile)
- All `/admin/*` (catalog, settings, users, crews, vans, restock approval)
- `/docs/:id` generic detail
- `/docs/:id/edit` as separate from new

**Strongest alignment:** Work-order spine (steps 1–5: new → prep → sign → field → review) + installer restock flow.

**Weakest:** Monica reports, Edgard steps 6–8 as dedicated screens, warehouse inventory/serials/Claro requests, Lissette run-builder, Carmen WinPay/Hacienda.

---

## Rollback Strategy: Feature Flags Per Screen

**Precondition for screen one:** A ported screen must ship without betting the app on it. Old screen reachable, one-line revert.

### Existing Mechanism

The app has a proven feature flag pattern in [`app/lib/features.server.ts`](../app/lib/features.server.ts):

```ts
export function isComptrollerEnabled(): boolean {
  return process.env.ENABLE_COMPTROLLER === "true"
}
```

Gated at three levels:

1. **Route definition** ([`app/routes.ts`](../app/routes.ts)) — route path unchanged:
   ```ts
   ...(ENABLE_COMPTROLLER ? [route("comptroller", "routes/_app.comptroller.tsx")] : [])
   ```

2. **Loader** (404 if disabled) — even if URL typed directly:
   ```ts
   if (!isComptrollerEnabled()) throw data(null, { status: 404 })
   ```

3. **Nav** ([`app-shell.tsx`](../app/components/app-shell.tsx)) — link hidden if feature off

### Recommended Pattern for Design System Port

Use **per-screen feature flags** for gradual rollout:

```ts
// app/lib/features.server.ts
export function isDesignSystemEnabled(): boolean {
  return process.env.ENABLE_DESIGN_SYSTEM === "true"
}

export function isInstallerDashboardV2Enabled(): boolean {
  return isDesignSystemEnabled() && process.env.ENABLE_INSTALLER_DASH_V2 === "true"
}
```

**Per-screen port:**

Keep existing route path, branch inside the loader:

```tsx
// app/routes/_app.installer.tsx (single route, stable URL)
export async function loader({ request }: LoaderArgs) {
  const user = await requireUser(request)
  
  if (isInstallerDashboardV2Enabled()) {
    // Load data for v2 (new design system)
    const pendingJobs = await getPendingJobsForInstaller(user.id)
    const completedThisWeek = await getCompletedThisWeek(user.id)
    const restockRequests = await getRestockRequests(user.id)
    return json({ version: "v2", pendingJobs, completedThisWeek, restockRequests })
  }
  
  // Load data for v1 (current screen)
  return json({ version: "v1", ...currentLoaderData })
}

export default function InstallerRoute() {
  const data = useLoaderData<typeof loader>()
  
  if (data.version === "v2") {
    return <InstallerDashboardV2 {...data} />
  }
  
  return <InstallerDashboardV1 {...data} />
}
```

**Why this pattern:**

- **Bookmarks preserved** — `/installer` URL stays the same when flag flips
- **Deep links work** — Query params, hash fragments survive both directions
- **No redirects** — Faster, no URL change, no flash
- **Clean rollback** — Set `ENABLE_INSTALLER_DASH_V2=false` → old component renders immediately

**Rollback:** Set `ENABLE_INSTALLER_DASH_V2=false` → V1 component renders. One-line revert in `.env` or deployment config.

### Alternative: Per-User Flag (Gradual Rollout to Users)

If per-screen env var is too coarse (all-or-nothing), add per-user opt-in:

```ts
// Add to User model
model User {
  ...
  enabledFeatures String[] @default([])  // e.g. ["INSTALLER_DASH_V2"]
}

// Feature check
export function isInstallerDashboardV2Enabled(user: User): boolean {
  return isDesignSystemEnabled() && user.enabledFeatures.includes("INSTALLER_DASH_V2")
}
```

Route logic reads user session, branches on user's flags. Admin can opt in 1-2 users for beta testing before full rollout.

### Verdict: Use Env Flags Per Screen Group

**Recommended:**

- **Global flag:** `ENABLE_DESIGN_SYSTEM` (master switch; turns off all new screens)
- **Per-role flags:** `ENABLE_INSTALLER_V2`, `ENABLE_WAREHOUSE_V2`, etc. (one per role dashboard + task screens)

**Not recommended:** Per-screen flags for every single screen (too many env vars). Group by role.

**Definition of done for every screen port includes:**

- Flag added to `features.server.ts`
- Route path unchanged; loader branches on the flag
- Old route still works when flag is off
- Nav/links respect flag
- `.env.example` documents new flag
- **Full port, not chrome-wrap:** The screen body renders in `.jaf-*` components (`Box`, `Field`, `Tag`, `.jaf-table`, `.jaf-inp`, etc.) inside a `.jaf-ds` wrapper. Wrapping an unchanged v1 form in DS chrome (`.jaf-greet` + `.jaf-flow` + `.jaf-box` around `{page}`) **does not count** as ported.
- **Gates from real data:** Any `.jaf-gate` checklist must reflect live loader or controlled form state. Never hardcode gate items (e.g. `photosOk={false}`) — the gate must be able to go green when the user satisfies the conditions.
- **Single progress model:** Do not show horizontal `.jaf-flow` and vertical `StepRail` (or duplicate back links / titles) on the same screen. Pick the blueprint progress UI and remove the v1 equivalent.
- **Single gate source:** Release and submit gates render once, from one computed source (e.g. `evaluateReleaseGate`), not duplicated in chrome and v1 body.

---

## Recommended Port Sequence

**Start with the role that carries the least logic:** Installer.

**Why Installer first:**

- **Smallest delta** — 4 of 8 guide screens already exist (dash, install, adjust, restock)
- **Self-contained** — installer screens do not depend on supervisor/finance state changes; they write and notify, but don't block other roles
- **High visual payoff** — completion wizard, van stock, restock flow are the most "designed" screens in the app; porting them demonstrates the system immediately

**Order within Installer** (revised for zero-schema-change first screen):

1. **`/installer` dashboard (thin slice)** — wire KPIs that already have data; render par-status KPI as honest "not wired yet" card per guide's own guidance. ZERO SCHEMA CHANGE. This proves the design system works before committing to data restructure. **✓ BUILT AND BROWSER-VERIFIED** (both themes, flag round-trip, same URL).

2. **Van stock restructure (additive migration)** — **PR 1 done:** `VanStockLevel` table + backfill + [`app/lib/van-stock.server.ts`](../app/lib/van-stock.server.ts). **PR 2 done:** route read/write cutover + par KPI wiring on installer v2 dashboard. JSON column retained as dual-write mirror.

3. **`/installer/adjust`** — van stock panel (depends on PR 2 route cutover)

4. **`/installer/install`** — completion wizard (depends on footage brackets #50, serial lookup #52)

5. **`/installer/restock` + `/restock/:id/pickup`** — restock request + dual-sig pickup

6. **Later:** swap, payments, history (new screens, lower urgency)

**Subsequent roles** (order after Installer):

1. **Frank (Warehouse)** — steps 2–3 (prep, pickup, returns) are clean; inventory/serials are additive gaps

2. **Jesús (Crew)** — steps 3–4 (pickup, field); low complexity, high volume

3. **Edgard (Supervisor)** — steps 5, 1 (review, new WO); defer steps 6–8 until structural gaps (release gate, PreCert screens) are scoped

4. **Lissette (Finance)** — queue/verify/receivables exist; run-builder + awaiting Carmen are new + depend on `PaymentRun` entity

5. **Carmen (Comptroller)** — almost entirely new screens + depends on `PaymentRun`/retention/Hacienda exports (structural)

6. **Monica (CEO)** — command-center reports are low-urgency, high-value; defer until all operational roles are ported

---

## Screen One: `/installer` Dashboard (Thin Slice, Zero Schema Change)

**✓ BUILT AND BROWSER-VERIFIED:** Both themes tested, flag round-trip works, same URL preserved.

### Definition of Done

**Components used:**

- `<KPI>` — 4 tiles (Pending, Completed this week, Par status placeholder, Restock requests)
- `<FlowStrip>` — if showing job detail (not on dashboard)
- `<EmptyState>` — "No pending jobs" when queue empty
- Existing app viz: `<Spark>`, `<MiniBars>` from [`dashboard-viz.tsx`](../app/components/dashboard-viz.tsx)
- `.jaf-greet` greeting block (generated sentence)
- `.jaf-box.c4.acc.glance` decisions tile ("Today" CTAs)
- `.jaf-box.c8` job queue table with `.jaf-split` stats underneath
- `.jaf-table` for job rows (or existing `<Table>` wrapped with `.jaf-table` class)
- `.jaf-tag.ok|warn|crit` status chips

**Data wired** (already exists):

- Pending jobs count — `InstallLog` where `installer = user`, not completed
- Completed this week count — `InstallLog` where `completedAt > startOfWeek`
- Completed trend (7-day sparkline) — query `InstallLog` grouped by day, last 7 days
- Restock requests count — `VanRestockRequest` where `installer = user`, `status != FULFILLED`
- Job queue table — pending `InstallLog` records with Claro ref, service type, date
- User name/role — session data

**Data NOT wired** (honest "not wired yet" cards):

- **Par status KPI** — render as `.jaf-kpi` with value "—" (em dash) and subtitle "Stock tracking coming soon" or similar. Per guide: "The UI can ship with a card that honestly says the data is not wired yet."
- **Units owed back** — omit from KPI strip (use 4-KPI layout `.kpis.k4`, not 5)

**Both themes:**

- Test in light mode (default)
- Test in dark mode (toggle in footer or via cookie)
- All guide tokens (`--plane`, `--surface`, `--ink`, `--accent`, etc.) render correctly in both
- No literal hex values in ported components

**Empty state:**

- When `pendingJobs.length === 0`, render `<EmptyState icon={PackageIcon} title="No pending jobs" description="New installations will appear here when assigned." />`

**i18n keys:**

- Extract all visible strings → i18n keys
- Seed Spanish from guide's `data-es` (mark `[UNPROOFED]`)
- Use `useTranslation` hook: `const { t } = useTranslation(); <h1>{t('installer.dashboard.title')}</h1>`

**Flag in place:**

- Add `isInstallerDashboardV2Enabled()` to [`features.server.ts`](../app/lib/features.server.ts)
- `/installer` stays the only route; loader branches on `isInstallerDashboardV2Enabled()`
- Return version discriminator (`"v1"` or `"v2"`) in loader data
- Route component conditionally renders `<InstallerDashboardV1>` or `<InstallerDashboardV2>`
- Document `ENABLE_INSTALLER_DASH_V2=true` in `.env.example`

**Old screen reachable:**

- Set `ENABLE_INSTALLER_DASH_V2=false` → V1 component renders from same `/installer` route
- Bookmarks, deep links, nav all preserved
- One-line revert in env config

### Why This Screen First (Revised Justification)

Original plan said installer dashboard, adjust, and wizard all depend on schema changes (par levels, serial lookup, footage brackets). That contradicts "low schema risk."

**Revised:** Installer dashboard with only the data that exists today is a true zero-schema-change proof of concept:

- Proves `.jaf-*` components render correctly
- Proves theme switching works (guide tokens → Tailwind dark mode)
- Proves i18n seed path (guide `data-es` → `remix-i18next`)
- Proves feature flag rollback works
- Honest about gaps — par-status KPI shows "—" with subtitle explaining it's not wired yet, per guide's own gap-register philosophy

After this screen ships, do the Van stock restructure (additive migration) as its own small PR, then port `/installer/adjust` which depends on it.

### Van stock deploy notes (PR 1 + backfill)

**Order:** `pnpm prisma migrate deploy` → shape inspection → backfill → deploy app (routes unchanged until PR 2).

**Hard gate before backfill on staging or production:** Dev has only empty-array van data; the strict `{ serviceCodeId, qty }` parser has not been exercised against real par rows. Run the read-only inspection and review output before backfill:

```bash
pnpm exec tsx scripts/inspect-van-stock-levels.ts
```

Proceed only if every van is a JSON **array**, each entry has valid `serviceCodeId` (non-empty string) and `qty` (numeric), and there are no duplicate `serviceCodeId` values per van. Extra fields on an entry (e.g. `name`) are fine — the parser ignores them. If inspection fails, fix data or extend the parser in a follow-up — do not run backfill blind.

**Verify table exists** (zero-row backfill does not prove the table was created):

```bash
pnpm exec tsx scripts/verify-van-stock-level-table.ts
```

**Backfill (idempotent):**

```bash
pnpm exec tsx scripts/backfill-van-stock-levels.ts
```

JSON column is never deleted or overwritten by backfill; invalid blobs are skipped and logged.

---

## Screen 2: `/installer/adjust` (Van Stock Adjust)

**Components needed:**

- `.greet` + `.jaf-back` link
- `.jaf-box.c12` — material list table
- `.jaf-inp` — quantity inputs (+ `.jaf-inp.ro` for locked "Took" column)
- `.jaf-field` — label + control stack
- `.jaf-actions` — button row (Save, Cancel)
- `.jaf-note.warn` — "2 below par · restock requested" banner

**Data it already has:**

- Van ID, installer link (`Van.installerId`)
- Par levels via [`getVanParLevels`](../app/lib/van-stock.server.ts) (PR 2 route cutover)
- Material catalog (`ServiceCode` where `kind = MATERIAL`)
- Transaction history (`VanInventoryTransaction`)
- **Below par count** — computed in loader via `buildInventoryComparison` (PR 2)

**Data it doesn't have:**

- **v2 UI port** — v1 form still shown when `ENABLE_INSTALLER_V2` is off; v2 chrome exists but full table port is a follow-up
- **Serial-tracked items (modems, ONTs)** — no `SerialUnit` register (schema gap #16)

---

## Screen 3: `/installer/install` (New Completion Wizard)

**Components needed:**

- `.greet` + `h1` + subtitle (rule sentence)
- `.jaf-tabs` — 4-panel wizard (Info, Device, Materials, Submit)
- `.jaf-field` + `.jaf-inp` — Claro job ref, service type, drop footage
- `.jaf-diff` — address correction diff (existing app component?)
- `.jaf-scan` — serial scan slot (custom component wrapping camera API)
- `.jaf-table` — accessory quantities (pre-filled from bracket)
- `.jaf-gate` — gate checklist ("Missing: form photo, signature")
- Signature pad (existing `<SignaturePad>` component, restyle with guide `.sig` markup)
- `.jaf-actions` — Submit button (disabled until gate clears)

**Data it already has:**

- Installer user ID
- Service types (free string on `InstallLog.serviceType`)
- Materials used JSON (`InstallLog.materialsUsed`)
- Completion signature flow (`InstallLog` has submission fields)

**Data it doesn't have:**

- **Footage bracket table** — no `AccessoryBracket` model (schema gap #50); defaults are hardcoded in mockups, must be data-driven
- **Serial → device/van lookup** — no `SerialUnit` register (schema gap #52); scan resolves to what?
- **Two materials have no SAP code** — guide shows this as chip; needs `ServiceCode` rows where `claroCode IS NULL` + UI handles gracefully (gap #51, already in mockups)
- **Photo + signature gate** — `InstallLog` has fields, but gate logic (disable Submit until both present) is app-side validation, not schema

---

## Anything Requiring Schema, Routes, Permissions, or Integrations (Scoped Separately)

**Do NOT fold into screen ports:**

### Schema changes

| Gap # | What | Why separate |
|-------|------|--------------|
| 9 | `Decimal(12,4)` precision | DB migration; must verify existing data precision |
| 12 | Split SERVICE vs MATERIAL catalogs | Major refactor of `ServiceCode` usage across 20+ files |
| 16 | `SerialUnit` register | New audit surface (Claro's 3x/year audits) |
| 17 | `WarehouseTransaction` log | Append-only; affects stock reconciliation logic |
| 28 | Aviso hard-block guard | State-machine transition rule; backend validation |
| 34–36 | `PaymentRun`, `RetentionAccrual` | Rewires all crew/installer payment flows |
| 38 | Carmen check-off per-line state | Changes how arm A closes (atomic transaction across 5 UI surfaces) |
| 40–43 | Collections ageing anchor, PO state machine, reconciliation snapshots | Finance reporting restructure |

### Routes / permissions

None — all ported screens reuse existing routes. New screens (e.g. Monica reports, Carmen Hacienda export) come later, after ops roles are ported.

### Integrations

- **WinPay ACH (gap #37)** — external payment system; ACH reference is recorded, not posted by this app. Adding the field is additive; hooking into WinPay is out of scope.
- **Hacienda export (gap #36)** — retention register CSV/XML export. Build the `RetentionAccrual` table first; export script is separate work.
- **Claro PDF upload / Ariba (gaps in finance)** — existing `claroPdfPath`, `claroUploadedAt` fields suggest integration exists; porting Lissette's screens reuses it.

---

## Additional Investigations

### Charts: Hand-Rolled SVG (Guide vs App)

**Guide ships:** Hand-rolled SVG helpers (`lineChart`, `barChart`, `ring`, `spark`, `mini` bars) in the kernel JS.

**App has:** Hand-rolled React SVG components in [`dashboard-viz.tsx`](../app/components/dashboard-viz.tsx):

- `<Ring>`, `<Spark>`, `<MiniBars>`, `<HBars>`, `<TrendChart>`, `<Legend>`
- Uses `--chart-1` and `--chart-2` Tailwind tokens

**Verdict:** ✓ Keep app's React versions. They already follow the guide's accent/accent-2 two-series convention. App's `--chart-1` = guide's `--accent`, `--chart-2` = guide's `--accent-2`. No conflict; no chart library needed.

---

### Dark Mode Token Mapping: Guide's 19 Tokens → App's Tailwind

Guide has 19 custom properties (`:root` block) declared 3x (light, OS-dark, forced-dark):

| Guide Token | Guide Purpose | App Tailwind Equivalent | Notes |
|-------------|---------------|------------------------|-------|
| `--plane` | Page background, rail | `--background` | App: `#f6f8f9` light, `#14181b` dark |
| `--surface` | Cards, inputs, active rail item | `--card` | App: `#ffffff` light, `#1c2124` dark |
| `--surface-2` | Recess inside card (tab track, read-only input) | `--muted` or `--secondary` | App: `#edf1f2` light, `#25292b` dark |
| `--ink` | Primary text, values | `--foreground` | App: `#25292b` light, `#edf1f2` dark |
| `--ink-2` | Body copy, secondary text | `--muted-foreground` | App: `#6b7478` light, `#98a2a6` dark |
| `--ink-3` | Labels, captions, placeholders | `--muted-foreground` (lighter) | Guide's `--ink-3` is same in both themes (`#898781`) — unusual. App varies. |
| `--hair` | 1px dividers | `--border` | App: `#dde3e5` light, `#33393c` dark |
| `--ring` | Card border | `--ring` | App already has `--ring` |
| `--accent` | Actions, links, charts | `--primary` / `--chart-1` | App: `#2b7c99` light, `#69afc9` dark |
| `--accent-2` | Second chart series, low bars | `--chart-2` | App: (chart-2 defined) |
| `--accent-ink` | Text on accent bg | `--primary-foreground` | App: `#ffffff` |
| `--accent-wash` | Selected/hover states | `--accent` (Tailwind semantic) | App: `#eff7fa` light, `#15303a` dark |
| `--critical` | Blocked, overdue, below min | `--status-danger` / `--destructive` | App: `#b91c1c` light, `#e07a7a` dark |
| `--warning` | Needs a look, discrepancy | `--status-warn` | App: `#b45309` light, `#e0a857` dark |
| `--good` | Approved, matched, paid | `--status-ok` | App: `#15803d` light, `#4ade80` dark |
| `--crit-wash` | Critical chip backgrounds | `--status-danger-soft` | App: `#fee2e2` light, `#341818` dark |
| `--warn-wash` | Warning chip backgrounds | `--status-warn-soft` | App: `#fef3c7` light, `#33260f` dark |
| `--good-wash` | Good chip backgrounds | `--status-ok-soft` | App: `#dcfce7` light, `#14291c` dark |
| `--shadow` | Card elevation | `--shadow-sm` / `--shadow-md` | App has 4 shadow levels; guide has 1 |

**Action:** Extract guide's `:root` block → add as CSS custom properties to [`app/app.css`](../app/app.css) after Tailwind's `@theme` block. This lets ported `.jaf-*` components use guide tokens while existing components continue using Tailwind tokens. Over time, migrate Tailwind-using components to guide tokens (e.g. replace `bg-background` with `bg-[var(--plane)]`).

**Theme persistence:** ✓ Already works correctly — [`theme.server.ts`](../app/lib/theme.server.ts) cookie → [`root.tsx`](../app/root.tsx) applies `<html className="dark">` before first paint. No flash.

---

### i18next vs `data-es` Conflict

**Problem:** Guide uses `data-es` attribute swapping (client-side JS toggle replaces text content). App uses `remix-i18next` with `useTranslation` hook (React declarative rendering).

These are incompatible. React controls the DOM; `data-es` attribute swapping fights React's virtual DOM.

**Resolution:**

1. **Drop guide's `data-es` JavaScript** — the lang-toggle kernel behavior cannot coexist with React

2. **Seed i18next keys from guide's `data-es` copy** — the guide's Spanish strings in `data-es="…"` attributes are the source material for `public/locales/es/*.json`

3. **Use `useTranslation` everywhere:**
   ```tsx
   const { t } = useTranslation()
   <h1>{t('dashboard.greeting')}</h1>
   <p>{t('dashboard.subtitle')}</p>
   ```

4. **Extraction script:** Write a one-time script to extract all `data-es="…"` from guide HTML → CSV (key | en | es), then seed i18n JSON files

5. **Mark seeded strings `[UNPROOFED]`** in JSON comments — guide's Spanish is placeholder, not native-speaker proofed

**Migration path:**

```bash
# Extract data-es attributes from guide
grep -oP 'data-es="\K[^"]+' JAF_Ops_Design_System_Guide.html > es-strings.txt

# Build i18n keys manually or via script
# public/locales/en/common.json
{
  "nav": {
    "dashboard": "Dashboard",
    "review": "Review queue"
  },
  "dashboard": {
    "greeting": "Good morning, you have 3 jobs waiting"
  }
}

# public/locales/es/common.json
{
  "nav": {
    "dashboard": "Panel de control",
    "review": "Cola de revisión"
  },
  "dashboard": {
    "greeting": "Buenos días, tienes 3 trabajos esperando"  // [UNPROOFED]
  }
}
```

**Do NOT:** Try to keep both `data-es` and `useTranslation` — pick one. `useTranslation` wins because the app already uses it everywhere (62+ files).

---

### Missing Primitives: Three Tracks

From guide § "Missing primitives": The guide identifies 3 gaps in the mockups that production needs.

#### 1. Keyboard Access & Focus → SEPARATE TRACK (Accessibility Work)

**Problem:** Guide's `.chk` (fake checkbox), `.sig` (signature pad), and custom controls are `<div>`/`<span>` elements with click handlers — not keyboard-operable, not screen-reader announced.

**Action:** Budget as separate accessibility pass after screen ports. Affects:

- `.jaf-chk` → rebuild as accessible checkbox (native `<input type=checkbox>` styled with guide appearance, or ARIA-compliant custom)
- `.jaf-sigpad` → ensure signature pad captures keyboard users (tab to field, Enter to begin drawing, Space to clear, etc.)
- All `.jaf-btn` equivalents must be `<button>` or `<a>` (not `<div>` with `onclick`)

**Why separate:** Accessibility retrofit of 51 screens is expensive; better to get 1–2 screens fully accessible (including keyboard) as the template, then replicate.

**Why budget now:** `.chk` and `.sigpad` move physical inventory (warehouse pickup, crew field update). If keyboard-only warehouse staff cannot use these, the port has failed.

#### 2. Print Styles → FOLD INTO SUPERVISOR/PRE-CERT WORK (Not Separate)

**Problem:** Guide has no `@media print` styles. The pre-cert sheet is a physical document that Claro wet-signs. It must print correctly (A4, black ink, no shadows, no dark mode bleed).

**Action:** When porting supervisor screens (steps 6–8: invoice, pre-cert, release), add print stylesheet at the same time:

- **Hide:** rail, top bar, buttons, nav
- **Show:** work order number, dates, line items, signature boxes
- **Force:** light theme tokens, black text, white bg, hairline borders only
- **Page breaks:** avoid breaking inside line-item tables

**Why not separate:** The pre-cert sheet is part of the supervisor's step-8 work, not a nice-to-have. If it doesn't print, the workflow is broken. Scope it into the supervisor screen port, not as follow-up work.

#### 3. Empty States → PART OF EVERY SCREEN'S DEFINITION OF DONE (Not Separate)

**Problem:** Guide mockups show populated tables/lists. Every ported screen needs an empty state (no jobs, no materials, no run history, etc.).

**Action:** When porting each screen, build the empty state at the same time:

- App already has [`<EmptyState>`](../app/components/ui/empty-state.tsx) component (icon + title + description + optional action)
- Style it with guide tokens (`--ink-3` for icon/text, `--surface` background)
- Use guide's copy style (short sentence + optional CTA, never "No items to display")

**Why not separate:** Retrofitting 51 empty states later is worse than building them as you go. Empty states are part of the screen, not polish. A queue with no items is a real state users will see (especially in dev/staging).

**Example:**

```tsx
{jobs.length === 0 ? (
  <EmptyState 
    icon={PackageIcon}
    title="No jobs in your queue"
    description="New work orders will appear here when they're assigned to you."
  />
) : (
  <Table>...</Table>
)}
```

---

## Risks (Ordered by Severity)

### 1. Step-enum mapping is timestamp-driven for steps 6–8 (CRITICAL)

**Risk:** Steps 6–8 are timestamp-driven, not `DocStatus` enum values:

- Step 6 (JAF invoice) → `jafInvoiceGeneratedAt` timestamp
- Step 7 (Aviso matched) → `avisoMatchedAt` timestamp (+ PreCert signatures as a gate within step 7)
- Step 8 (To Finance) → `releasedToFinanceAt` timestamp

This means:

- The `.jaf-flow` strip cannot render from `status` alone — it must call `deriveSupervisorStage` (reads status + 3 timestamps)
- Tables sorting "by step" need a computed `derivedStep` column, not raw `DocStatus` sort
- Jobs at `SUPERVISOR_APPROVED` may be at step 5, 6, 7, or 8 depending on which timestamps are set

**Mitigation:**

- Keep the guide's 1–8 numbered flow strip — render `<FlowStrip steps={8} current={derivedStepNumber} you={roleSteps} />`
- Derive step number from `deriveSupervisorStage` → map to 1–8 (see §3 for mapping logic)
- Use guide's step labels on the `.jaf-flow` strip: "Created", "Warehouse prep", "Crew signs out", "Field work", "You review", "JAF invoice", "Aviso matched", "To Finance"
- Add computed `derivedStep` getter to `JafInvoice` model for table sorts (calls `deriveSupervisorStage` → step number)
- Document mapping in [`supervisor-stage.ts`](../app/lib/supervisor-stage.ts) header comment (see revised §3 above)

### 2. Aviso amount mismatch must hard-block (CRITICAL)

**Rule from guide:** "A job cannot reach step 8 by any route if `avisoLineTotal` ≠ `jafInvoiceLineTotal`." (Screen Rules § Invoicing)

**Current reality:** `avisoMatchedAt` timestamp exists; app sets it when amounts match. But nothing prevents a supervisor from manually advancing status if they bypass the UI validation.

**Risk:** Backend does not enforce the block — a malicious or confused user could mark a mismatched job as released, violating the money control.

**Mitigation:**

- Add transition guard in [`permissions.ts`](../app/lib/permissions.ts) `canTransition()`: before allowing `SUPERVISOR_APPROVED` → `CLARO_UPLOADED` or setting `releasedToFinanceAt`, assert `avisoMatchedAt IS NOT NULL`
- UI shows red `.jaf-tag.crit` chip ("Aviso ≠ invoice · blocked") and disables Release button; backend repeats the check in the mutation

### 3. "Used" can never exceed "Took" (HIGH)

**Rule:** Crew field update clamps `materialsUsed[i].qty` to ≤ `materialsTaken[i].qty`. (Screen Rules § Crew field update)

**Current reality:** App stores both JSON blobs; unclear if validation exists in [`_app.docs.$id_.field.tsx`](../app/routes/_app.docs.$id_.field.tsx).

**Risk:** If crew reports using more than they took, the returns reconciliation at step 8 (gate item 7) will fail, blocking supervisor release.

**Mitigation:**

- Add client-side clamp on input blur: `if (used > took) { setUsed(took); toast("Used cannot exceed Took"); }`
- Backend validation in field-update mutation repeats the check — clamp or reject

### 4. Carmen's check-off must move 5 surfaces atomically (HIGH)

**Rule:** "One check-off updates: the row chip, Lissette's 'Awaiting Carmen' count, the run status, the inbox KPI, the retention total. If they can disagree, they eventually will, and this is the screen where disagreement costs money." (Screen Rules § Carmen check-off)

**Current reality:** No check-off flow exists yet (Carmen screens missing).

**Risk:** When built, a naive implementation writes 5 independent database updates → if one fails mid-transaction, the UI state diverges (e.g. Carmen sees "paid", Lissette still sees "awaiting").

**Mitigation:**

- One transaction in the check-off mutation: update `PaymentRun.linesChecked`, create `Notification` to Lissette, update `RetentionAccrual`, all inside `prisma.$transaction()`
- One broadcast via WebSocket/SSE to live-update Lissette's screen (or she refreshes and sees it)
- UI polling/refetch on Carmen's screen after check-off to confirm all 5 surfaces updated

### 5. Tailwind utility collisions (MEDIUM)

**Risk:** Landing guide CSS globally creates specificity fights with Tailwind (e.g. `.grid { display:grid; grid-template-columns:repeat(12,1fr) }` vs Tailwind's `.grid` utility).

**Mitigation:** Namespace with `.jaf-` prefix (see verdict in §1). One scripted rename solves it permanently.

### 6. Theme persistence works, but i18n needs seeding (LOW)

**Risk:** The guide's `data-es` Spanish copy is placeholder, not proofed by a native speaker. Porting screens blindly copies unproofed strings into the app's i18n layer.

**Mitigation:**

- Seed i18n keys from guide copy as a starting point only
- Mark all seeded strings as `[UNPROOFED]` in JSON
- Route proofed translations through a native ops speaker before release

**Note:** Theme persistence already works correctly (`theme.server.ts` → `root.tsx` applies before first paint) — no flash risk. ✓

i18next mechanism: Guide's `data-es` JS must be replaced with `remix-i18next` (see Additional Investigations § i18next Conflict above). Seed i18n keys from guide's Spanish copy, mark as `[UNPROOFED]`.

---

## Detailed Supporting Files

- **Full 53-row gap reconciliation:** [gap-reconciliation-53.md](gap-reconciliation-53.md) — Every claim mapped to existing field or verdict (satisfied/additive/structural)
- **All 11 screen rules documented:** [screen-rules-11.md](screen-rules-11.md) — Business constraints per screen, where enforced, gaps, severity
- **Component mapping table:** [component-mapping.md](component-mapping.md) — Guide component → app component → verdict (wrap/replace/new); includes i18next vs `data-es` resolution

---

## Summary

**Prefix verdict:** Yes — `.jaf-` namespace required to avoid Tailwind/component collisions (see §1).

**Port sequence:** Installer first (least logic, high payoff), then Warehouse, Crew, Supervisor steps 1–5, Finance, Comptroller, CEO last.

**First 3 screens:**

1. **Installer dashboard (thin slice)** — use only existing data; par-status KPI renders "—" with "not wired yet" subtitle. ZERO SCHEMA CHANGE. **✓ BUILT AND BROWSER-VERIFIED.**

2. **Van adjust** — PR 2 route cutover landed; v2 UI port remains follow-up

3. **Completion wizard** — needs footage bracket table, serial lookup, gate validation logic (additive gaps #50, #52)

**Schema/route/integration work (separate):**

- `SerialUnit`, `WarehouseTransaction`, `PaymentRun`, `RetentionAccrual` models
- Aviso hard-block guard in state machine
- Carmen check-off atomic transaction
- Hacienda export (after retention table)
- `Decimal(12,4)` price precision verification

**Risks (top 3):**

1. Step-enum mapping is timestamp-driven for steps 6–8 — derive step 1–8 from `deriveSupervisorStage`, not raw `DocStatus`
2. Aviso amount mismatch block must be backend-enforced, not just UI
3. Carmen check-off must update 5 surfaces in one transaction

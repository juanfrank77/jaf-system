# Component Mapping: Guide → App

**How guide classes/components map to existing React components in the app.**

---

## The Verdict Table

| Guide Component | Guide Class | Existing App Component | Verdict | Notes |
|-----------------|-------------|------------------------|---------|-------|
| **Card / Panel** | `.box` → `.jaf-box` | `<Card>` from shadcn | **WRAP** | Wrap shadcn `Card` internals with `.jaf-box` class; or create new `<DesignSystemCard>` component rendering guide markup |
| **Status chip** | `.tag` → `.jaf-tag` | `<Badge>` from shadcn | **REPLACE** | Guide `.jaf-tag.ok\|warn\|crit\|acc` has specific severity semantics; shadcn `Badge` is generic. Create new `<StatusChip variant="ok\|warn\|crit\|acc">` wrapping guide markup. |
| **Text input** | `.inp` → `.jaf-inp` | `<Input>` from shadcn | **WRAP** | Add `.jaf-inp` class to shadcn `Input`; or create `<DesignSystemInput>` component |
| **Checkbox** | `.chk` → `.jaf-chk` | `<Checkbox>` from shadcn (native) | **REPLACE** | Guide uses **fake checkbox** (span with click handler) for visual consistency. Must replace with accessible version (see "Missing primitives: Keyboard"). Shadcn `Checkbox` is native `<input type=checkbox>`, different semantics. |
| **Tabs** | `.tabs` → `.jaf-tabs` | `<Tabs>` from Base UI | **REPLACE** | Guide `.jaf-tabs` is segmented control (pill style) in top bar. App `Tabs` is underline style. Different patterns; build new `<SegmentedControl>` component from guide markup. |
| **Count pill/badge** | `.pill` → `.jaf-pill` (on rail links) | `<Pill>` component (alert banner) | **NEW** | **Semantic conflict**. Guide `.jaf-pill` = small red count badge ("2 waiting"). App `Pill` = soft alert banner (info/warn). Build new `<CountBadge>` for guide's pill; keep app `Pill` for banners. |
| **KPI metric tile** | `.kpi` → `.jaf-kpi` | `<Stat>` component (bordered card) | **NEW** | **Semantic conflict**. Guide `.jaf-kpi` = large metric tile with viz (ring/spark/bars). App `Stat` = smaller bordered card. Build new `<KPI>` component from guide markup; app `Stat` ≈ guide `.jaf-split .jaf-stat` (small label+value pair). |
| **Stat pair** | `.stat` (inside `.split`) → `.jaf-stat` | `<Stat>` component | **RENAME APP** | Guide `.jaf-stat` = small label+value pair (no border, inside `.jaf-split`). App `Stat` is closer to guide `.jaf-kpi`. Rename app `Stat` → `MetricCard`; build new `<Stat>` for guide's small pair. |
| **Flow strip** | `.flow` → `.jaf-flow` | `<StepRail>` component | **WRAP** | App `StepRail` is vertical stage progress. Guide `.jaf-flow` is horizontal 8-step strip with `.done`, `.on`, `.you` markers. Build new `<FlowStrip>` component; keep `StepRail` for supervisor detail sidebar. |
| **Button** | `.btn` → `.jaf-btn` | `<Button>` from shadcn | **WRAP** | Add `.jaf-btn` class to shadcn `Button`; or extend with guide modifiers (`.jaf-ghost`, `.jaf-acc`, `.jaf-blue`, `.jaf-sm`) |
| **Form field** | `.field` → `.jaf-field` | `<Label>` + input stack | **WRAP** | Guide `.jaf-field` = vertical label+control wrapper. App uses separate `Label` + `Input`. Build `<Field label>` wrapper component. |
| **Table** | `.table` → `.jaf-table` | `<Table>` from shadcn | **WRAP** | Guide table has specific classes (`.num`, `.act`, `.mono` cells). Wrap shadcn `Table` or build `<DesignSystemTable>`. |
| **Empty state** | *(not in guide)* | `<EmptyState>` component | **KEEP** | App already has `EmptyState`. Guide mockups don't show empty states. Use app component; style with guide tokens. |
| **Loading** | *(not in guide)* | None | **NEW** | Guide has no loading primitive. Build from guide tokens (accent spinner + surface). |
| **Print styles** | `.print` media queries | None | **NEW** | Guide § "Missing primitives" notes print isn't in mockups but pre-cert sheet is physical. Add print stylesheet for supervisor/pre-cert screens. |

---

## Visualization Components (Guide JS → App)

| Guide | App Equivalent | Verdict |
|-------|----------------|---------|
| Ring chart (`.ring` SVG helper) | `<Ring>` in [`dashboard-viz.tsx`](../app/components/dashboard-viz.tsx) | **KEEP APP** - Already uses `--chart-1`/`--chart-2` (maps to guide accent/accent-2) |
| Sparkline (`.spark` SVG helper) | `<Spark>` | **KEEP APP** - Same pattern, same tokens |
| Mini bars (`.mini` inline bars) | `<MiniBars>` | **KEEP APP** - Same pattern |
| Horizontal bars (`.bars` grid layout) | `<HBars>` | **KEEP APP** - Same pattern |
| Trend chart (hand-rolled line chart) | `<TrendChart>` | **KEEP APP** - Same pattern, hover tooltip exists |
| Legend | `<Legend>` | **KEEP APP** |

**Verdict:** App's hand-rolled viz components already follow guide's accent/accent-2 two-series convention. **No conflict; keep app's React versions.**

---

## JavaScript Behavior (Guide Kernel → React Router)

| Guide Kernel (`data-*` attributes) | React Router Equivalent | Action |
|-------------------------------------|-------------------------|--------|
| `data-go` / `data-screen` routing | `<Link to>` + React Router routes | **REPLACE** - Use `<Link>`; drop guide's client-side screen-swapping JS |
| `data-es` i18n attribute swapping | `remix-i18next` + `useTranslation` | **REPLACE** - Seed i18n keys from guide's `data-es` copy; drop guide's lang-toggle JS (see i18next Conflict below) |
| `data-flip` / `data-toast` action feedback | Toast library (if exists) or build | **ADAPT** - Guide's `.toast` markup is simple (slide-in from top). Keep pattern; wire to React state. |
| `data-tab` / `data-panel` tab switching | React state (`useState`) | **REPLACE** - Guide uses DOM manipulation; React uses controlled components |
| `data-filter` table filtering | Controlled input + filter logic | **REPLACE** - React state for filter value |
| `data-requires` gate logic | Form validation + `disabled` prop | **ADAPT** - Guide gates via DOM selectors; React uses validation state |
| Theme toggle (`data-theme` on `<html>`) | `theme.server.ts` cookie + `root.tsx` | **KEEP APP** - Already works correctly (no flash) |
| Ring/spark/chart helpers (inline SVG generation) | App's React viz components | **KEEP APP** |

---

## i18next vs `data-es` Conflict

**Problem:** Guide uses `data-es` attribute swapping (client-side JS replaces text content). App uses `remix-i18next` with `useTranslation` hook (server-side + client-side key lookup).

**Resolution:**

1. **Drop guide's `data-es` JS** — incompatible with React's declarative rendering
2. **Seed i18next keys from guide's `data-es` copy** — the guide's Spanish strings are the starting point for translation JSON
3. **Use `useTranslation` everywhere** — `const { t } = useTranslation(); <span>{t('dashboard.greeting')}</span>`
4. **Mark seeded strings `[UNPROOFED]`** — guide copy is placeholder, not native-speaker proofed

**Migration path:**

- Extract all `data-es="..."` attributes from guide HTML → CSV (`en` | `es`)
- Seed `public/locales/es/common.json` with those strings
- Build components using `t()` keys, not hardcoded text
- Route proofed translations through native ops speaker before release

---

## Action Items

1. **Build new components** from guide markup:
   - `<KPI>` (large metric tile with viz slot)
   - `<StatusChip variant="ok|warn|crit|acc">` (severity chip)
   - `<CountBadge>` (red pill for rail counts)
   - `<FlowStrip steps={8} current={5} you={[5,6,7,8]}>` (8-step horizontal strip)
   - `<Stat label value delta?>` (small label+value pair for `.split`)
   - `<Field label>` (vertical label+control wrapper)
   - `<SegmentedControl>` (pill-style tabs for top bar)

2. **Wrap/extend existing** shadcn components:
   - Add `.jaf-box` to `Card`
   - Add `.jaf-inp`, `.jaf-btn` classes to `Input`, `Button`
   - Build `<DesignSystemTable>` wrapper

3. **Keep app's viz components** — already aligned with guide's accent/accent-2 convention

4. **Seed i18next from `data-es`** — extract guide's Spanish copy → JSON

5. **Replace guide's JS** — `data-go` → `<Link>`, `data-tab` → React state, `data-flip` → toast component

---

## Principle

**Prefer wrapping/extending shadcn components** over building from scratch — they have accessibility baked in. Where guide and shadcn semantics differ (e.g. `.pill` badge vs alert banner), build new component with guide's markup and shadcn's a11y patterns.

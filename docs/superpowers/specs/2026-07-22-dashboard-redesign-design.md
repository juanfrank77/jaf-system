# Dashboard & Shell Redesign

Date: 2026-07-22
Status: Approved for planning

## Context

Login is fixed and users can reach the dashboard, but the current UI (`app/routes/_app.tsx` shell + `app/routes/_app.dashboard.tsx`) is a bare header + centered list with generic Tailwind slate styling. The user's partner produced a static mockup (`docs/jaf-os.html`) showing a role-driven look: sticky top bar, left role rail, stat tiles, pill alerts, card/table document views, and status badges, in a teal/navy brand palette with light/dark themes.

This pass restyles the **app shell and dashboard only** — not the per-step task screens (prep, field, sign, review, lc, audit-package), which keep their current styling for now and get their own pass later.

## Visual direction

Adopt the mockup's look closely: brand palette, card/pill/badge patterns, spacing — not just its layout structure.

The app already has a full shadcn CSS-variable theme (`app/app.css`) including unused `--sidebar-*` tokens (defined but never applied, since there's currently no sidebar). This redesign finally uses them.

## Design

### 1. Theme (`app/app.css`)

- Repoint `--primary` (and `.dark`'s `--primary`) at the mockup's brand teal so existing shadcn components (Button, Input focus rings, etc.) adopt it automatically. Light: `oklch` equivalent of `#0d5c4f`. Dark: equivalent of `#2fae93`.
- Add new semantic status tokens, light + dark, matching the mockup's `--info`/`--warn`/`--danger`/`--ok` plus `-soft` background variants:
  `--status-info`, `--status-info-soft`, `--status-warn`, `--status-warn-soft`, `--status-danger`, `--status-danger-soft`, `--status-danger-line`, `--status-ok`, `--status-ok-soft`.
- Wire these into `@theme inline` as `--color-status-*` so they're usable as Tailwind utility classes (`bg-status-ok-soft`, `text-status-danger`, etc.), same mechanism already used for `--color-sidebar-*`.
- `--sidebar*` tokens stay as-is; the new rail component consumes them directly (`bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`).
- No change to `--radius` or typography tokens.

### 2. New presentational primitives (`app/components/ui/`)

Small, dependency-free Tailwind components, following the existing style of `button.tsx`/`input.tsx` (function component + `cn()` class merging, no new libraries):

- `badge.tsx` — status pill (`ok` / `warn` / `danger` / `info` / `neutral` variants), used for `DocStatus`.
- `card.tsx` — `Card`, `CardHeader`, `CardContent` — thin wrappers matching the mockup's `.card`/`.hd`/`.bd`.
- `stat.tsx` — `Stat` tile (label + big value), used in the stats row.
- `pill.tsx` — the mockup's alert pill (icon + message), variants matching badge.

### 3. Shell (`app/routes/_app.tsx`)

Replace the current header-only, `max-w-2xl`-centered layout with:

- **Top bar** (sticky): logo mark (letter avatar in brand color) + "JAF Ops" wordmark, spacer, user name + role badge, notification bell (unchanged behavior), sign-out button. Visually modeled on the mockup's `.topbar`.
- **Left rail** (`w-56`-ish, `bg-sidebar`, hidden below `md:`): role-scoped nav links, reusing existing route guards as the source of truth for which links show:
  - Dashboard — all roles
  - + New Document — SUPERVISOR, ADMIN
  - Receivables — FINANCE, ADMIN
  - Admin (settings/catalog) — ADMIN
  - Active link highlighted with `bg-sidebar-accent` per current route (`useLocation` from react-router).
- **Main content**: fluid width (drop `max-w-2xl`), reasonable `max-w-6xl mx-auto` wrapper so wide tables/stat rows have room, `px-4 md:px-8 py-6`.
- Mobile (`<md`): rail hidden (matches mockup's `@media(max-width:760px){.rail{display:none}}`); top bar nav collapses to just Dashboard link + existing links stay reachable via the page itself. No hamburger/drawer in this pass — out of scope; note as a known gap.
- Loader already returns `user.role`; extend the shell loader's user projection to keep `role` (already does) — no data changes needed here.

### 4. Dashboard (`app/routes/_app.dashboard.tsx`)

Loader: unchanged data-fetching shape (`user`, `docs`), but compute a small role-specific stats/alert summary from the already-fetched `docs` list (no new queries):

- **SUPERVISOR**: open docs (not `LC_GENERATED`), awaiting warehouse (`CREATED`), awaiting crew (`PREPPED`/`SIGNED`).
- **WAREHOUSE**: pending preps (`CREATED`), count needing action.
- **CREW**: assigned open jobs (not `LC_GENERATED`), awaiting close (`SIGNED`/`FIELD_UPDATED`).
- **FINANCE / ADMIN**: open receivables-eligible docs (`SUPERVISOR_APPROVED`/`CLARO_UPLOADED`/`LC_GENERATED` — mirrors the existing receivables loader's filter), total doc count, count in each status.

Layout:

- Stats row: 2–4 `Stat` tiles per role (mockup's `.stats`), computed from the counts above.
- One alert `Pill` (info/warn) surfacing the single most actionable fact for the role (e.g. "3 documents waiting on your prep" for WAREHOUSE when count > 0); omitted if nothing needs attention.
- Document list restyled into the mockup's card/table look (`Card` wrapping a simple table or stacked rows — reuse existing row data/links, `Link to={/docs/${doc.id}}` unchanged), with `Badge` replacing the current inline `STATUS_COLORS` span for `doc.status`.
- Empty state ("No documents yet.") keeps current copy, styled inside the `Card`.

Existing top-of-page action links (Receivables / + New Document) move into the new shell's rail (§3), so the dashboard page itself drops that header row and just gets `h1` + stats + alert + list.

### Out of scope

- Per-step task screens (prep, field, sign, review, lc, audit-package) — unchanged, later pass.
- Mobile hamburger/drawer nav — rail simply hides under `md`.
- Any new data/queries beyond what the dashboard loader already fetches.
- i18n (mockup has ES/EN toggle; app is English-only today, not adding a language switcher here).

## Testing

- Manual check via `run` skill: log in as each of the 5 roles (or swap `user.role` in dev data) and confirm: correct rail links show, stats reflect real doc counts, alert pill logic (shows/hides correctly), status badges render correct colors for each `DocStatus`, dark mode (`.dark` class) renders correctly for new tokens.
- No new automated tests planned — this is a presentational change over existing loader data with no new business logic beyond the stat-counting derived values, which are simple array filters.

# Dashboard & Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the app shell (top bar + role-scoped nav) and the dashboard landing page to match the visual language of the partner-provided mockup (`docs/jaf-os.html`) — brand teal palette, role rail, stat tiles, alert pills, card/badge document list — without touching the per-step task screens (prep/field/sign/review/lc/audit-package).

**Architecture:** Add new CSS custom-property tokens to `app/app.css` (brand + semantic status colors), build four small presentational UI primitives (`badge`, `card`, `stat`, `pill`) alongside the existing `app/components/ui/*` primitives, extract the shell and dashboard into presentational components (`AppShell`, `DashboardView`) so they're unit-testable without a DB, and keep the route files (`_app.tsx`, `_app.dashboard.tsx`) as thin loader + render wrappers. Role-specific dashboard numbers are computed by a pure helper function, `computeDashboardStats`, unit-tested in isolation.

**Tech Stack:** React Router 7 (file routes), Tailwind CSS v4 (`@theme inline` token wiring), `class-variance-authority` for variant styling, `~/lib/utils#cn` for class merging, Vitest browser-mode (Playwright) tests via the existing `renderStub` test helper in `tests/setup.browser.tsx`, plain Vitest for non-component logic.

## Global Constraints

- Scope is the app shell (`app/routes/_app.tsx`) and dashboard (`app/routes/_app.dashboard.tsx`) only. Do not modify `_app.docs.$id_.*` task screens.
- Adopt the mockup's palette and component look closely (brand teal `#0d5c4f` / dark-mode `#2fae93`, semantic info/warn/danger/ok tokens), not just its structure.
- No new npm dependencies — build primitives with `class-variance-authority` + `cn`, matching `app/components/ui/button.tsx`'s existing pattern.
- Reuse existing loader data shapes; no new Prisma queries beyond what `_app.tsx` and `_app.dashboard.tsx` already fetch.
- Mobile: role rail hides below `md`; no hamburger/drawer in this pass.
- Follow existing repo conventions: tabs for indentation (match surrounding files), `~/` import alias for `app/*`, relative `../../generated/prisma/client` import for `Role`/`DocStatus` types (see `app/lib/permissions.server.ts:2`).
- Every new component file gets a co-located `*.browser.test.tsx` (component tests) or `*.test.ts` (pure logic tests), following the existing pattern in `app/library/language-switcher/LanguageSwitcher.browser.test.tsx`.

---

## File Structure

- `app/app.css` — **modify**: add brand + semantic status color tokens.
- `app/components/ui/badge.tsx` — **create**: status pill primitive (variants: `ok`/`warn`/`danger`/`info`/`neutral`).
- `app/components/ui/badge.browser.test.tsx` — **create**.
- `app/components/ui/card.tsx` — **create**: `Card`, `CardHeader`, `CardContent` wrappers.
- `app/components/ui/card.browser.test.tsx` — **create**.
- `app/components/ui/stat.tsx` — **create**: `Stat` tile (label + value).
- `app/components/ui/stat.browser.test.tsx` — **create**.
- `app/components/ui/pill.tsx` — **create**: alert pill (icon + message, variants `info`/`warn`).
- `app/components/ui/pill.browser.test.tsx` — **create**.
- `app/lib/dashboard-stats.ts` — **create**: pure `computeDashboardStats(role, docs)` helper.
- `app/lib/dashboard-stats.test.ts` — **create**.
- `app/components/app-shell.tsx` — **create**: presentational shell (top bar + role rail + content slot), role-scoped nav config.
- `app/components/app-shell.browser.test.tsx` — **create**.
- `app/routes/_app.tsx` — **modify**: keep loader as-is, render `<AppShell>` instead of inline header/main markup.
- `app/components/dashboard-view.tsx` — **create**: presentational dashboard body (stats row, alert pill, document list).
- `app/components/dashboard-view.browser.test.tsx` — **create**.
- `app/routes/_app.dashboard.tsx` — **modify**: loader calls `computeDashboardStats`, component renders `<DashboardView>`.

---

### Task 1: Theme tokens

**Files:**
- Modify: `app/app.css`

**Interfaces:**
- Produces: CSS custom properties `--status-info`, `--status-info-soft`, `--status-warn`, `--status-warn-soft`, `--status-danger`, `--status-danger-soft`, `--status-danger-line`, `--status-ok`, `--status-ok-soft` (light in `:root`, dark overrides in `.dark`), each wired into `@theme inline` as `--color-status-*` so `bg-status-ok`, `text-status-ok`, `bg-status-ok-soft`, etc. Tailwind utilities exist. Repoints `--primary` / `.dark`'s `--primary` at the brand teal.

This task has no isolated unit test (CSS custom properties aren't unit-testable). It's verified end-to-end by Task 2's Badge test, which asserts the rendered element resolves a non-transparent background color from these tokens.

- [ ] **Step 1: Add brand primary override**

In `app/app.css`, inside the existing `:root { ... }` block, change:

```css
	--primary: oklch(0.205 0 0);
	--primary-foreground: oklch(0.985 0 0);
```

to:

```css
	--primary: #0d5c4f;
	--primary-foreground: oklch(0.985 0 0);
```

In the existing `.dark { ... }` block, change:

```css
	--primary: oklch(0.922 0 0);
	--primary-foreground: oklch(0.205 0 0);
```

to:

```css
	--primary: #2fae93;
	--primary-foreground: oklch(0.205 0 0);
```

- [ ] **Step 2: Add semantic status tokens**

In `app/app.css`, at the end of the `:root { ... }` block (right before its closing `}`), add:

```css
	--status-info: #185fa5;
	--status-info-soft: #e6f1fb;
	--status-warn: #854f0b;
	--status-warn-soft: #faeeda;
	--status-danger: #a32d2d;
	--status-danger-soft: #fcebeb;
	--status-danger-line: #f0a5a5;
	--status-ok: #3b6d11;
	--status-ok-soft: #eaf3de;
```

At the end of the `.dark { ... }` block (right before its closing `}`), add:

```css
	--status-info: #5fa3e6;
	--status-info-soft: #142a40;
	--status-warn: #e0a857;
	--status-warn-soft: #33260f;
	--status-danger: #e07a7a;
	--status-danger-soft: #341818;
	--status-danger-line: #5a2727;
	--status-ok: #8fc04f;
	--status-ok-soft: #1c2913;
```

- [ ] **Step 3: Wire tokens into Tailwind's theme**

In `app/app.css`, inside the `@theme inline { ... }` block, add these lines (anywhere among the existing `--color-*` lines, e.g. right after `--color-background: var(--background);`):

```css
	--color-status-info: var(--status-info);
	--color-status-info-soft: var(--status-info-soft);
	--color-status-warn: var(--status-warn);
	--color-status-warn-soft: var(--status-warn-soft);
	--color-status-danger: var(--status-danger);
	--color-status-danger-soft: var(--status-danger-soft);
	--color-status-danger-line: var(--status-danger-line);
	--color-status-ok: var(--status-ok);
	--color-status-ok-soft: var(--status-ok-soft);
```

- [ ] **Step 4: Verify build isn't broken**

Run: `pnpm run typecheck`
Expected: exits 0 (CSS changes don't affect TypeScript, this just confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add app/app.css
git commit -m "style: add brand teal and semantic status color tokens"
```

---

### Task 2: `Badge` primitive

**Files:**
- Create: `app/components/ui/badge.tsx`
- Test: `app/components/ui/badge.browser.test.tsx`

**Interfaces:**
- Produces: `Badge({ variant, className, children, ...props }: { variant?: "ok" | "warn" | "danger" | "info" | "neutral" } & React.ComponentProps<"span">)`, default export not used — named export `Badge`.

- [ ] **Step 1: Write the failing test**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./badge"

describe("Badge", () => {
	it("renders its label", async ({ renderStub }) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <Badge variant="ok">Closed</Badge> }],
		})
		expect(screen.getByText("Closed")).toBeInTheDocument()
	})

	it("resolves a non-transparent background from the status token", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <Badge variant="danger">Flagged</Badge> }],
		})
		const el = screen.getByText("Flagged")
		const bg = getComputedStyle(el).backgroundColor
		expect(bg).not.toBe("")
		expect(bg).not.toBe("rgba(0, 0, 0, 0)")
		expect(bg).not.toBe("transparent")
	})

	it("defaults to the neutral variant", async ({ renderStub }) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <Badge>Draft</Badge> }],
		})
		expect(screen.getByText("Draft")).toHaveAttribute("data-variant", "neutral")
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/components/ui/badge.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './badge'` (or similar resolution error).

- [ ] **Step 3: Write the implementation**

```tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
	{
		variants: {
			variant: {
				ok: "bg-status-ok-soft text-status-ok",
				warn: "bg-status-warn-soft text-status-warn",
				danger: "bg-status-danger-soft text-status-danger",
				info: "bg-status-info-soft text-status-info",
				neutral: "bg-muted text-muted-foreground",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
)

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			data-variant={variant ?? "neutral"}
			className={cn(badgeVariants({ variant, className }))}
			{...props}
		/>
	)
}

export { Badge, badgeVariants }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/components/ui/badge.browser.test.tsx --project="browser tests"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/badge.tsx app/components/ui/badge.browser.test.tsx
git commit -m "feat: add Badge status pill primitive"
```

---

### Task 3: `Card` primitive

**Files:**
- Create: `app/components/ui/card.tsx`
- Test: `app/components/ui/card.browser.test.tsx`

**Interfaces:**
- Produces: `Card`, `CardHeader`, `CardContent` — all `React.ComponentProps<"div">` wrappers with `cn`-merged classes.

- [ ] **Step 1: Write the failing test**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Card, CardContent, CardHeader } from "./card"

describe("Card", () => {
	it("renders header and content", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<Card>
							<CardHeader>Title</CardHeader>
							<CardContent>Body</CardContent>
						</Card>
					),
				},
			],
		})
		expect(screen.getByText("Title")).toBeInTheDocument()
		expect(screen.getByText("Body")).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/components/ui/card.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './card'`

- [ ] **Step 3: Write the implementation**

```tsx
import { cn } from "~/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-card shadow-sm",
				className,
			)}
			{...props}
		/>
	)
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-semibold",
				className,
			)}
			{...props}
		/>
	)
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-content" className={cn("p-4", className)} {...props} />
	)
}

export { Card, CardHeader, CardContent }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/components/ui/card.browser.test.tsx --project="browser tests"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/card.tsx app/components/ui/card.browser.test.tsx
git commit -m "feat: add Card primitive"
```

---

### Task 4: `Stat` primitive

**Files:**
- Create: `app/components/ui/stat.tsx`
- Test: `app/components/ui/stat.browser.test.tsx`

**Interfaces:**
- Produces: `Stat({ label, value, className }: { label: string; value: string | number; className?: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Stat } from "./stat"

describe("Stat", () => {
	it("renders label and value", async ({ renderStub }) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <Stat label="Open docs" value={7} /> }],
		})
		expect(screen.getByText("Open docs")).toBeInTheDocument()
		expect(screen.getByText("7")).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/components/ui/stat.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './stat'`

- [ ] **Step 3: Write the implementation**

```tsx
import { cn } from "~/lib/utils"

function Stat({
	label,
	value,
	className,
}: {
	label: string
	value: string | number
	className?: string
}) {
	return (
		<div
			data-slot="stat"
			className={cn(
				"rounded-xl border border-border bg-card p-4 shadow-sm",
				className,
			)}
		>
			<div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</div>
			<div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
		</div>
	)
}

export { Stat }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/components/ui/stat.browser.test.tsx --project="browser tests"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/stat.tsx app/components/ui/stat.browser.test.tsx
git commit -m "feat: add Stat tile primitive"
```

---

### Task 5: `Pill` primitive

**Files:**
- Create: `app/components/ui/pill.tsx`
- Test: `app/components/ui/pill.browser.test.tsx`

**Interfaces:**
- Produces: `Pill({ variant, icon, children, className }: { variant: "info" | "warn"; icon?: React.ReactNode; children: React.ReactNode; className?: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Pill } from "./pill"

describe("Pill", () => {
	it("renders its message", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <Pill variant="warn">3 documents waiting on your prep</Pill>,
				},
			],
		})
		expect(
			screen.getByText("3 documents waiting on your prep"),
		).toBeInTheDocument()
	})

	it("renders an optional icon", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<Pill variant="info" icon={<span data-testid="icon">i</span>}>
							Heads up
						</Pill>
					),
				},
			],
		})
		expect(screen.getByTestId("icon")).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/components/ui/pill.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './pill'`

- [ ] **Step 3: Write the implementation**

```tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const pillVariants = cva(
	"flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
	{
		variants: {
			variant: {
				info: "bg-status-info-soft text-foreground",
				warn: "bg-status-warn-soft text-foreground",
			},
		},
	},
)

function Pill({
	className,
	variant,
	icon,
	children,
}: {
	icon?: React.ReactNode
	children: React.ReactNode
} & VariantProps<typeof pillVariants> &
	Pick<React.ComponentProps<"div">, "className">) {
	return (
		<div data-slot="pill" className={cn(pillVariants({ variant, className }))}>
			{icon && <span className="text-lg leading-none">{icon}</span>}
			<div>{children}</div>
		</div>
	)
}

export { Pill }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/components/ui/pill.browser.test.tsx --project="browser tests"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/pill.tsx app/components/ui/pill.browser.test.tsx
git commit -m "feat: add Pill alert primitive"
```

---

### Task 6: `computeDashboardStats` helper

**Files:**
- Create: `app/lib/dashboard-stats.ts`
- Test: `app/lib/dashboard-stats.test.ts`

**Interfaces:**
- Consumes: `Role` type from `../../generated/prisma/client` (values: `"SUPERVISOR" | "CREW" | "WAREHOUSE" | "FINANCE" | "ADMIN"`); `DocStatus` type from the same module (values: `"CREATED" | "PREPPED" | "SIGNED" | "FIELD_UPDATED" | "SUPERVISOR_APPROVED" | "CLARO_UPLOADED" | "LC_GENERATED"`).
- Produces:
  - `type DashboardDoc = { status: DocStatus; receivableClosedAt: Date | null }`
  - `type DashboardStat = { label: string; value: number }`
  - `type DashboardAlert = { variant: "info" | "warn"; message: string } | null`
  - `function computeDashboardStats(role: Role, docs: DashboardDoc[]): { stats: DashboardStat[]; alert: DashboardAlert }`

Consumed by `app/routes/_app.dashboard.tsx` (Task 8).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest"
import { computeDashboardStats } from "./dashboard-stats"

const doc = (status: string, receivableClosedAt: Date | null = null) => ({
	status: status as never,
	receivableClosedAt,
})

describe("computeDashboardStats", () => {
	it("SUPERVISOR: counts open docs and docs awaiting warehouse/crew", () => {
		const docs = [
			doc("CREATED"),
			doc("PREPPED"),
			doc("SIGNED"),
			doc("LC_GENERATED"),
		]
		const { stats } = computeDashboardStats("SUPERVISOR", docs)
		expect(stats).toEqual([
			{ label: "Open documents", value: 3 },
			{ label: "Awaiting warehouse", value: 1 },
			{ label: "Awaiting crew", value: 2 },
		])
	})

	it("SUPERVISOR: alerts when documents are awaiting warehouse", () => {
		const { alert } = computeDashboardStats("SUPERVISOR", [doc("CREATED"), doc("CREATED")])
		expect(alert).toEqual({
			variant: "info",
			message: "2 documents awaiting warehouse",
		})
	})

	it("WAREHOUSE: counts pending preps and alerts when > 0", () => {
		const docs = [doc("CREATED"), doc("CREATED"), doc("SIGNED")]
		const { stats, alert } = computeDashboardStats("WAREHOUSE", docs)
		expect(stats).toEqual([{ label: "Pending preps", value: 2 }])
		expect(alert).toEqual({
			variant: "warn",
			message: "2 documents waiting on your prep",
		})
	})

	it("WAREHOUSE: no alert when nothing is pending", () => {
		const { alert } = computeDashboardStats("WAREHOUSE", [doc("SIGNED")])
		expect(alert).toBeNull()
	})

	it("CREW: counts open jobs and jobs awaiting close", () => {
		const docs = [doc("SIGNED"), doc("FIELD_UPDATED"), doc("LC_GENERATED")]
		const { stats, alert } = computeDashboardStats("CREW", docs)
		expect(stats).toEqual([
			{ label: "Open jobs", value: 2 },
			{ label: "Awaiting close", value: 2 },
		])
		expect(alert).toEqual({ variant: "warn", message: "2 jobs ready to close" })
	})

	it("FINANCE: counts total docs, open receivables, awaiting Claro upload", () => {
		const docs = [
			doc("SUPERVISOR_APPROVED"),
			doc("CLARO_UPLOADED"),
			doc("LC_GENERATED", new Date("2026-01-01")),
			doc("CREATED"),
		]
		const { stats, alert } = computeDashboardStats("FINANCE", docs)
		expect(stats).toEqual([
			{ label: "Total documents", value: 4 },
			{ label: "Open receivables", value: 2 },
			{ label: "Awaiting Claro upload", value: 1 },
		])
		expect(alert).toEqual({ variant: "info", message: "2 receivables open" })
	})

	it("ADMIN: uses the same computation as FINANCE", () => {
		const docs = [doc("CLARO_UPLOADED")]
		expect(computeDashboardStats("ADMIN", docs)).toEqual(
			computeDashboardStats("FINANCE", docs),
		)
	})

	it("returns no alert when the doc list is empty", () => {
		expect(computeDashboardStats("SUPERVISOR", []).alert).toBeNull()
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run app/lib/dashboard-stats.test.ts --project="server tests"`
Expected: FAIL — `Cannot find module './dashboard-stats'`

- [ ] **Step 3: Write the implementation**

```ts
import type { DocStatus, Role } from "../../generated/prisma/client"

export type DashboardDoc = {
	status: DocStatus
	receivableClosedAt: Date | null
}

export type DashboardStat = { label: string; value: number }

export type DashboardAlert = { variant: "info" | "warn"; message: string } | null

const RECEIVABLE_STATUSES: DocStatus[] = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_GENERATED",
]

function count(docs: DashboardDoc[], pred: (d: DashboardDoc) => boolean) {
	return docs.filter(pred).length
}

export function computeDashboardStats(
	role: Role,
	docs: DashboardDoc[],
): { stats: DashboardStat[]; alert: DashboardAlert } {
	if (role === "SUPERVISOR") {
		const open = count(docs, (d) => d.status !== "LC_GENERATED")
		const awaitingWarehouse = count(docs, (d) => d.status === "CREATED")
		const awaitingCrew = count(
			docs,
			(d) => d.status === "PREPPED" || d.status === "SIGNED",
		)
		return {
			stats: [
				{ label: "Open documents", value: open },
				{ label: "Awaiting warehouse", value: awaitingWarehouse },
				{ label: "Awaiting crew", value: awaitingCrew },
			],
			alert:
				awaitingWarehouse > 0
					? {
							variant: "info",
							message: `${awaitingWarehouse} document${awaitingWarehouse === 1 ? "" : "s"} awaiting warehouse`,
						}
					: null,
		}
	}

	if (role === "WAREHOUSE") {
		const pendingPreps = count(docs, (d) => d.status === "CREATED")
		return {
			stats: [{ label: "Pending preps", value: pendingPreps }],
			alert:
				pendingPreps > 0
					? {
							variant: "warn",
							message: `${pendingPreps} document${pendingPreps === 1 ? "" : "s"} waiting on your prep`,
						}
					: null,
		}
	}

	if (role === "CREW") {
		const openJobs = count(docs, (d) => d.status !== "LC_GENERATED")
		const awaitingClose = count(
			docs,
			(d) => d.status === "SIGNED" || d.status === "FIELD_UPDATED",
		)
		return {
			stats: [
				{ label: "Open jobs", value: openJobs },
				{ label: "Awaiting close", value: awaitingClose },
			],
			alert:
				awaitingClose > 0
					? {
							variant: "warn",
							message: `${awaitingClose} job${awaitingClose === 1 ? "" : "s"} ready to close`,
						}
					: null,
		}
	}

	// FINANCE and ADMIN share the same view
	const totalDocs = docs.length
	const openReceivables = count(
		docs,
		(d) => RECEIVABLE_STATUSES.includes(d.status) && !d.receivableClosedAt,
	)
	const awaitingClaroUpload = count(docs, (d) => d.status === "SUPERVISOR_APPROVED")
	return {
		stats: [
			{ label: "Total documents", value: totalDocs },
			{ label: "Open receivables", value: openReceivables },
			{ label: "Awaiting Claro upload", value: awaitingClaroUpload },
		],
		alert:
			openReceivables > 0
				? {
						variant: "info",
						message: `${openReceivables} receivable${openReceivables === 1 ? "" : "s"} open`,
					}
				: null,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/lib/dashboard-stats.test.ts --project="server tests"`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/dashboard-stats.ts app/lib/dashboard-stats.test.ts
git commit -m "feat: add computeDashboardStats helper for role-scoped dashboard numbers"
```

---

### Task 7: `AppShell` presentational component + wire into `_app.tsx`

**Files:**
- Create: `app/components/app-shell.tsx`
- Test: `app/components/app-shell.browser.test.tsx`
- Modify: `app/routes/_app.tsx`

**Interfaces:**
- Consumes: `Role` type from `../../generated/prisma/client`.
- Produces: `AppShell({ user, notifications, children }: { user: { name: string; role: Role }; notifications: { id: string }[]; children: React.ReactNode })`, rendered by `app/routes/_app.tsx`. Internal (not exported): `NAV_ITEMS` config array of `{ to: string; label: string; roles?: Role[] }`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AppShell } from "./app-shell"

describe("AppShell", () => {
	it("shows the user's name and role", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell user={{ name: "Jose Alfaro", role: "SUPERVISOR" }} notifications={[]}>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("Jose Alfaro")).toBeInTheDocument()
		expect(screen.getByText("SUPERVISOR")).toBeInTheDocument()
	})

	it("renders children in the main content slot", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell user={{ name: "Jose Alfaro", role: "SUPERVISOR" }} notifications={[]}>
							<p>dashboard body</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("dashboard body")).toBeInTheDocument()
	})

	it("shows + New Document for SUPERVISOR but not Admin links", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell user={{ name: "Jose Alfaro", role: "SUPERVISOR" }} notifications={[]}>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByRole("link", { name: "+ New Document" })).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Admin Settings" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Receivables" })).not.toBeInTheDocument()
	})

	it("shows only Dashboard for CREW", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell user={{ name: "L. Rivera", role: "CREW" }} notifications={[]}>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "+ New Document" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Receivables" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Admin Settings" })).not.toBeInTheDocument()
	})

	it("shows every nav item for ADMIN", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell user={{ name: "Monica García", role: "ADMIN" }} notifications={[]}>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "+ New Document" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Receivables" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Admin Settings" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Catalog" })).toBeInTheDocument()
	})

	it("shows the unread notification count", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[{ id: "1" }, { id: "2" }]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("2")).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run app/components/app-shell.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './app-shell'`

- [ ] **Step 3: Write the implementation**

```tsx
import { Form, Link, useLocation } from "react-router"
import type { Role } from "../../generated/prisma/client"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type NavItem = { to: string; label: string; roles?: Role[] }

const NAV_ITEMS: NavItem[] = [
	{ to: "/dashboard", label: "Dashboard" },
	{ to: "/docs/new", label: "+ New Document", roles: ["SUPERVISOR", "ADMIN"] },
	{ to: "/finance/receivables", label: "Receivables", roles: ["FINANCE", "ADMIN"] },
	{ to: "/admin/settings", label: "Admin Settings", roles: ["ADMIN"] },
	{ to: "/admin/catalog", label: "Catalog", roles: ["ADMIN"] },
]

function initials(name: string) {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("")
}

function AppShell({
	user,
	notifications,
	children,
}: {
	user: { name: string; role: Role }
	notifications: { id: string }[]
	children: React.ReactNode
}) {
	const location = useLocation()
	const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role))

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-border bg-card px-4.5 py-2.5">
				<Link to="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
					<span className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">
						J
					</span>
					JAF Ops
				</Link>
				<div className="flex-1" />
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<span className="font-medium text-foreground">{user.name}</span>
					<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">
						{user.role}
					</span>
					<button type="button" className="relative text-muted-foreground">
						🔔
						{notifications.length > 0 && (
							<span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-status-danger text-[10px] text-white">
								{notifications.length}
							</span>
						)}
					</button>
					<Form method="post" action="/api/auth/sign-out">
						<Button type="submit" variant="ghost" size="sm">
							Sign out
						</Button>
					</Form>
				</div>
			</header>
			<div className="flex min-h-[calc(100vh-51px)]">
				<aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:block">
					<div className="mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
						<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
							{initials(user.name)}
						</span>
						<div className="text-sm font-semibold text-sidebar-foreground">{user.name}</div>
					</div>
					<nav className="flex flex-col gap-1">
						{items.map((item) => {
							const active = location.pathname === item.to
							return (
								<Link
									key={item.to}
									to={item.to}
									className={cn(
										"rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground",
										active
											? "bg-sidebar-accent text-sidebar-accent-foreground"
											: "hover:bg-sidebar-accent/60",
									)}
								>
									{item.label}
								</Link>
							)
						})}
					</nav>
				</aside>
				<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>
			</div>
		</div>
	)
}

export { AppShell }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/components/app-shell.browser.test.tsx --project="browser tests"`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire `AppShell` into the route**

Replace the full contents of `app/routes/_app.tsx` with:

```tsx
import { Outlet } from "react-router"
import { AppShell } from "~/components/app-shell"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const notifications = await db.notification.findMany({
		where: { userId: session.user.id, read: false },
		orderBy: { createdAt: "desc" },
		take: 10,
	})
	return { user: { name: user.name, role: user.role }, notifications }
}

export default function AppShellRoute({ loaderData }: Route.ComponentProps) {
	const { user, notifications } = loaderData
	return (
		<AppShell user={user} notifications={notifications}>
			<Outlet />
		</AppShell>
	)
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm run typecheck`
Expected: exits 0

- [ ] **Step 7: Commit**

```bash
git add app/components/app-shell.tsx app/components/app-shell.browser.test.tsx app/routes/_app.tsx
git commit -m "feat: redesign app shell with role rail and branded top bar"
```

---

### Task 8: `DashboardView` presentational component + wire into `_app.dashboard.tsx`

**Files:**
- Create: `app/components/dashboard-view.tsx`
- Test: `app/components/dashboard-view.browser.test.tsx`
- Modify: `app/routes/_app.dashboard.tsx`

**Interfaces:**
- Consumes: `Badge` (Task 2), `Card`/`CardHeader`/`CardContent` (Task 3), `Stat` (Task 4), `Pill` (Task 5), `DashboardStat`/`DashboardAlert` types (Task 6), `DocStatus` type from `../../generated/prisma/client`.
- Produces: `DashboardView({ stats, alert, docs }: { stats: DashboardStat[]; alert: DashboardAlert; docs: DashboardDocRow[] })` where `DashboardDocRow = { id: string; controlNumber: string; status: DocStatus; jobType: string; jobAddressEstimated: string; createdAt: Date }`. Rendered by `app/routes/_app.dashboard.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardView } from "./dashboard-view"

const doc = (overrides: Partial<Parameters<typeof DashboardView>[0]["docs"][number]> = {}) => ({
	id: "1",
	controlNumber: "JAF-10493",
	status: "CREATED" as const,
	jobType: "Installation",
	jobAddressEstimated: "Cupey, San Juan",
	createdAt: new Date("2026-07-01"),
	...overrides,
})

describe("DashboardView", () => {
	it("renders a stat tile per entry", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[{ label: "Open documents", value: 3 }]}
							alert={null}
							docs={[]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("Open documents")).toBeInTheDocument()
		expect(screen.getByText("3")).toBeInTheDocument()
	})

	it("renders the alert pill when present", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{ variant: "warn", message: "2 documents waiting on your prep" }}
							docs={[]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("2 documents waiting on your prep")).toBeInTheDocument()
	})

	it("omits the alert pill when null", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <DashboardView stats={[]} alert={null} docs={[]} /> },
			],
		})
		expect(screen.queryByText(/waiting on your prep/)).not.toBeInTheDocument()
	})

	it("renders each document as a link with its status badge", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							docs={[doc({ id: "abc", status: "LC_GENERATED" })]}
						/>
					),
				},
			],
		})
		const link = screen.getByRole("link", { name: /JAF-10493/ })
		expect(link).toHaveAttribute("href", "/docs/abc")
		expect(screen.getByText("LC GENERATED")).toBeInTheDocument()
	})

	it("shows an empty state when there are no documents", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <DashboardView stats={[]} alert={null} docs={[]} /> },
			],
		})
		expect(screen.getByText("No documents yet.")).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run app/components/dashboard-view.browser.test.tsx --project="browser tests"`
Expected: FAIL — `Cannot find module './dashboard-view'`

- [ ] **Step 3: Write the implementation**

```tsx
import { Link } from "react-router"
import type { DocStatus } from "../../generated/prisma/client"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Pill } from "~/components/ui/pill"
import { Stat } from "~/components/ui/stat"
import type { DashboardAlert, DashboardStat } from "~/lib/dashboard-stats"

export type DashboardDocRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
}

const STATUS_BADGE_VARIANT: Record<DocStatus, "ok" | "warn" | "danger" | "info"> = {
	CREATED: "warn",
	PREPPED: "info",
	SIGNED: "info",
	FIELD_UPDATED: "warn",
	SUPERVISOR_APPROVED: "info",
	CLARO_UPLOADED: "info",
	LC_GENERATED: "ok",
}

function DashboardView({
	stats,
	alert,
	docs,
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	docs: DashboardDocRow[]
}) {
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Dashboard</h1>

			{stats.length > 0 && (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					{stats.map((stat) => (
						<Stat key={stat.label} label={stat.label} value={stat.value} />
					))}
				</div>
			)}

			{alert && (
				<Pill variant={alert.variant} icon={alert.variant === "warn" ? "⚠" : "🔔"}>
					{alert.message}
				</Pill>
			)}

			<Card>
				<CardContent className="space-y-2 p-3">
					{docs.length === 0 && (
						<p className="p-2 text-sm text-muted-foreground">No documents yet.</p>
					)}
					{docs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}`}
							className="block rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-sm font-medium">{doc.controlNumber}</span>
								<Badge variant={STATUS_BADGE_VARIANT[doc.status]}>
									{doc.status.replace(/_/g, " ")}
								</Badge>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.createdAt.toLocaleDateString()}
							</p>
						</Link>
					))}
				</CardContent>
			</Card>
		</div>
	)
}

export { DashboardView }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run app/components/dashboard-view.browser.test.tsx --project="browser tests"`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire `DashboardView` into the route**

Replace the full contents of `app/routes/_app.dashboard.tsx` with:

```tsx
import { DashboardView } from "~/components/dashboard-view"
import { db } from "~/lib/db.server"
import { computeDashboardStats } from "~/lib/dashboard-stats"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.dashboard"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	const docs = await db.jafInvoice.findMany({
		where:
			user.role === "SUPERVISOR"
				? { supervisorId: user.id }
				: user.role === "CREW"
					? { assignedCrewIds: { has: user.id } }
					: {}, // WAREHOUSE, FINANCE, ADMIN see all
		orderBy: { createdAt: "desc" },
		take: 20,
	})

	const { stats, alert } = computeDashboardStats(user.role, docs)

	return { stats, alert, docs }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const { stats, alert, docs } = loaderData
	return <DashboardView stats={stats} alert={alert} docs={docs} />
}
```

Per the spec, the old header row's `Receivables` / `+ New Document` links are dropped from the dashboard page entirely — `AppShell`'s rail (Task 7) already surfaces both for the roles that need them, so this avoids duplicating the same links in two places.

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: exits 0

- [ ] **Step 7: Full test run**

Run: `pnpm vitest run`
Expected: PASS — all suites, including the pre-existing ones (`control-number.server.test.ts`, `system-settings.server.test.ts`, `i18n.server.test.ts`, `LanguageSwitcher.browser.test.tsx`) plus every test added in this plan.

- [ ] **Step 8: Commit**

```bash
git add app/components/dashboard-view.tsx app/components/dashboard-view.browser.test.tsx app/routes/_app.dashboard.tsx
git commit -m "feat: redesign dashboard with stat tiles, alert pill, and card document list"
```

---

## Manual verification (post-implementation)

Automated tests cover component logic; do a manual pass afterward (per the `run` skill) to confirm end-to-end look and feel, since role-based visuals aren't fully exercised by component tests against real data:

1. Start the dev server, log in as a SUPERVISOR, CREW, WAREHOUSE, FINANCE, and ADMIN user in turn (or swap seed data).
2. For each: confirm the rail shows only the expected links, stat tiles reflect real doc counts, the alert pill appears/disappears correctly, and document status badges use sensible colors.
3. Toggle dark mode (`.dark` class, however the app currently applies it — check `prefers-color-scheme` handling in `app/app.css`) and confirm the new tokens render legibly in both themes.
4. Resize to mobile width and confirm the rail hides per the `md:` breakpoint.

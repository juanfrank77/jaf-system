import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RoleDashboard } from "./role-dashboard"

const base = { stats: [], alert: null, explainer: null, docs: [] }
const emptyQueues = {
	pendingReview: [],
	approved: [],
	sentBack: [],
	missingAviso: [],
	blocked: [],
}

// Spread so biome's a11y rule does not mistake the `role` prop for an ARIA role.
const supervisor = {
	role: "SUPERVISOR" as const,
	supervisorQueues: emptyQueues,
}

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("RoleDashboard", () => {
	for (const role of [
		"CREW",
		"WAREHOUSE",
		"FINANCE",
		"ADMIN",
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"COMPTROLLER",
	] as const) {
		it(`renders the dashboard for ${role}`, async ({ renderStub }) => {
			await mount(
				renderStub,
				<RoleDashboard role={role} supervisorQueues={null} {...base} />,
			)
			expect(
				screen.getByRole("heading", { level: 1, name: "Dashboard" }),
			).toBeInTheDocument()
		})
	}

	it("renders the five supervisor queues and the work-order list for SUPERVISOR", async ({
		renderStub,
	}) => {
		await mount(renderStub, <RoleDashboard {...supervisor} {...base} />)
		expect(
			screen.getByRole("heading", { level: 1, name: "Dashboard" }),
		).toBeInTheDocument()
		// five queue cards + "All work orders"
		expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6)
		expect(
			screen.getByRole("heading", { level: 2, name: "All work orders" }),
		).toBeInTheDocument()
	})
})

const statKeys = [
	"open_documents",
	"awaiting_warehouse",
	"awaiting_crew",
	"pending_review",
	"stage_awaiting_warehouse",
	"stage_awaiting_crew",
	"stage_pending_review",
	"stage_in_finance",
	"discrepancy_count",
	"shortage_count",
	"overage_count",
	"aging_oldest_days",
	"aging_po_wait_count",
	"aging_claro_wait_count",
] as const
const fourteenStats = statKeys.map((k, i) => ({
	labelKey: `dashboard.stat.${k}` as const,
	value: i,
}))

const queueRow = (o: Record<string, unknown> = {}) => ({
	id: "r1",
	controlNumber: "JAF-2026-1043",
	jobAddressEstimated: "CAM 906, Yabucoa",
	jobAddressActual: null,
	brigadeName: "Jesús Martínez",
	stage: "APPROVE" as const,
	amount: null,
	note: null,
	since: null,
	qtyDiscrepancy: false,
	...o,
})

describe("SupervisorDashboard", () => {
	const mountSupervisor = (
		renderStub: any,
		props: Record<string, unknown> = {},
	) =>
		mount(
			renderStub,
			<RoleDashboard
				{...supervisor}
				{...base}
				stats={fourteenStats}
				supervisorScope={{ areas: ["CENTRAL"], brigadeCount: 4 }}
				{...props}
			/>,
		)

	it("shows seven working tiles and folds the ten accounting metrics", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				sentBack: [queueRow({ id: "s" })],
				blocked: [queueRow({ id: "b" }), queueRow({ id: "b2" })],
			},
		})
		const tiles = screen.getByTestId("supervisor-tiles")
		expect(tiles.querySelectorAll('[data-slot="stat"]')).toHaveLength(7)
		// the three queue tiles carry the queue counts
		expect(within(tiles).getByText("Sent back").nextSibling).toHaveTextContent(
			"1",
		)
		expect(within(tiles).getByText("Blocked").nextSibling).toHaveTextContent(
			"2",
		)
		const fold = screen.getByTestId("more-metrics")
		expect(fold.querySelectorAll('[data-slot="stat"]')).toHaveLength(10)
		expect(fold.tagName).toBe("DETAILS")
		expect(fold).not.toHaveAttribute("open")
		expect(within(fold).getByText("Oldest open (days)")).toBeInTheDocument()
	})

	it("shows the supervisor's area and crew count under the title", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub)
		expect(screen.getByText("Central · 4 crews")).toBeInTheDocument()
	})

	it("shows the approval banner only when there is one", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			alert: {
				variant: "warn",
				key: "dashboard.alert.pending_review",
				count: 2,
			},
		})
		expect(
			screen.getByText("2 jobs awaiting your approval"),
		).toBeInTheDocument()
	})

	it("renders the filter bar when filters are enabled", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, { showFilters: true })
		expect(screen.getByRole("searchbox")).toBeInTheDocument()
	})

	it("lists all work orders", async ({ renderStub }) => {
		await mountSupervisor(renderStub, {
			docs: [
				{
					id: "d1",
					controlNumber: "JAF-2026-1001",
					status: "CREATED",
					jobType: "Mantenimiento",
					jobAddressEstimated: "PR-2 KM 45.3, Aguadilla",
					createdAt: new Date("2026-07-21"),
				},
			],
		})
		expect(screen.getByText("JAF-2026-1001")).toBeInTheDocument()
	})

	it("shows how long a row has been waiting and flags quantity discrepancies", async ({
		renderStub,
	}) => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		const oneDayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000)
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				pendingReview: [queueRow({ since: twoHoursAgo, qtyDiscrepancy: true })],
				sentBack: [
					queueRow({
						id: "s",
						stage: "FIELD",
						since: oneDayAgo,
						note: "retake photos",
					}),
				],
			},
		})
		expect(screen.getByText("Submitted 2h ago")).toBeInTheDocument()
		expect(screen.getByText("Returned 1d ago")).toBeInTheDocument()
		expect(screen.getByText("retake photos")).toBeInTheDocument()
		expect(screen.getByText("Qty discrepancy")).toBeInTheDocument()
	})
})

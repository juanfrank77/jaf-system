import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RoleDashboard } from "./role-dashboard"

const base = { stats: [], alert: null, explainer: null, docs: [] }
const emptyQueues = {
	myOpen: [],
	intake: [],
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

const finance = { role: "FINANCE" as const, supervisorQueues: null }

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
				screen.getByRole("heading", {
					level: 1,
					name: role === "CREW" ? "My jobs" : "Dashboard",
				}),
			).toBeInTheDocument()
		})
	}

	it("renders the seven supervisor queues and the work-order list for SUPERVISOR", async ({
		renderStub,
	}) => {
		await mount(renderStub, <RoleDashboard {...supervisor} {...base} />)
		expect(
			screen.getByRole("heading", { level: 1, name: "Dashboard" }),
		).toBeInTheDocument()
		// seven queue cards (My open work orders last); dashboard no longer has an "All work orders" section
		const headings = screen.getAllByRole("heading", { level: 2 })
		expect(headings).toHaveLength(7)
		expect(headings.at(-1)).toHaveTextContent("My open work orders")
	})

	it("colors the supervisor count tiles by what they count", async ({
		renderStub,
	}) => {
		await mount(renderStub, <RoleDashboard {...supervisor} {...base} />)
		const tone = (label: string) =>
			within(screen.getByTestId("supervisor-tiles"))
				.getByText(label)
				.closest('[data-slot="stat"]') as HTMLElement
		expect(tone("Blocked")).toHaveAttribute("data-tone", "flag")
		expect(tone("Missing Aviso")).toHaveAttribute("data-tone", "warn")
	})

	const billedDoc = {
		id: "d1",
		controlNumber: "JAF-1",
		status: "CLARO_UPLOADED" as const,
		jobType: "Install",
		jobAddressEstimated: "Calle 1",
		createdAt: new Date("2026-10-01T12:00:00Z"),
		avisoNumber: "12345678",
	}

	for (const role of ["WAREHOUSE", "CREW"] as const) {
		it(`hides the Aviso number from the ${role} dashboard`, async ({
			renderStub,
		}) => {
			await mount(
				renderStub,
				<RoleDashboard
					role={role}
					supervisorQueues={null}
					{...base}
					docs={[billedDoc]}
				/>,
			)
			// Warehouse works from its four queues only (mockup v3): no all-docs list.
			if (role === "WAREHOUSE") {
				expect(screen.queryByText("JAF-1")).not.toBeInTheDocument()
			} else {
				expect(screen.getByText("JAF-1")).toBeInTheDocument()
			}
			expect(screen.queryByText(/12345678/)).not.toBeInTheDocument()
		})
	}

	it("keeps the Aviso number on the FINANCE document list", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<RoleDashboard {...finance} {...base} docs={[billedDoc]} />,
		)
		expect(screen.getByText(/12345678/)).toBeInTheDocument()
	})

	it("shows the warehouse a count card per step, linking to its page", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<RoleDashboard
				{...{ role: "WAREHOUSE" }}
				supervisorQueues={null}
				{...base}
				warehouseCounts={{ prep: 3, release: 2, returns: 4 }}
			/>,
		)
		expect(screen.getByRole("link", { name: /To prep.*3/ })).toHaveAttribute(
			"href",
			"/warehouse/prep",
		)
		expect(
			screen.getByRole("link", { name: /Awaiting pickup.*2/ }),
		).toHaveAttribute("href", "/warehouse/release")
		expect(
			screen.getByRole("link", { name: /Returns due.*4/ }),
		).toHaveAttribute("href", "/warehouse/returns")
	})

	it("shows the warehouse one set of count cards, not a second stat row", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<RoleDashboard
				{...{ role: "WAREHOUSE" }}
				supervisorQueues={null}
				{...base}
				stats={[{ labelKey: "dashboard.stat.open_documents", value: 9 }]}
				warehouseCounts={{ prep: 3, release: 2, returns: 4 }}
			/>,
		)
		expect(screen.getAllByText("Awaiting pickup")).toHaveLength(1)
		expect(screen.queryByText("Open documents")).not.toBeInTheDocument()
	})

	it("keeps the incoming to-prep orders on the warehouse dashboard but not the other step lists", async ({
		renderStub,
	}) => {
		const order = (id: string, controlNumber: string) => ({
			id,
			controlNumber,
			status: "CREATED" as const,
			jobType: "Install",
			jobAddressEstimated: "Calle 1",
			createdAt: new Date("2026-10-01T12:00:00Z"),
		})
		await mount(
			renderStub,
			<RoleDashboard
				{...{ role: "WAREHOUSE" }}
				supervisorQueues={null}
				{...base}
				warehouseToPrepDocs={[order("p1", "JAF-PREP-1")]}
			/>,
		)
		expect(screen.getByText("JAF-PREP-1")).toBeInTheDocument()
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

	it("lists just-created work orders in an Intake section that opens the job", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				intake: [queueRow({ id: "new1", controlNumber: "JAF-NEW" })],
			},
		})
		expect(
			screen.getByRole("heading", { level: 2, name: /New — waiting/ }),
		).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "JAF-NEW" })).toHaveAttribute(
			"href",
			"/docs/new1",
		)
	})

	it("opens the list behind each count tile", async ({ renderStub }) => {
		await mountSupervisor(renderStub, {
			stats: [
				{ labelKey: "dashboard.stat.open_documents", value: 5 },
				{ labelKey: "dashboard.stat.awaiting_warehouse", value: 1 },
				{ labelKey: "dashboard.stat.awaiting_crew", value: 2 },
				{ labelKey: "dashboard.stat.pending_review", value: 3 },
			],
		})
		const tiles = screen.getByTestId("supervisor-tiles")
		const hrefOf = (label: string) =>
			within(tiles).getByText(label).closest("a")?.getAttribute("href")
		expect(hrefOf("Open documents")).toBe("/dashboard?stage=all")
		expect(hrefOf("Awaiting warehouse")).toBe("/dashboard?stage=intake")
		expect(hrefOf("Awaiting crew")).toBe("/dashboard?stage=field")
		expect(hrefOf("Pending review")).toBe("/dashboard?stage=review")
		expect(hrefOf("Sent back")).toMatch(/#sent-back$/)
		expect(hrefOf("Missing Aviso")).toMatch(/#missing-aviso$/)
		expect(hrefOf("Blocked")).toMatch(/#blocked$/)
	})

	it("lists the supervisor's open work orders with their step and who they wait on", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				myOpen: [
					queueRow({
						id: "o1",
						controlNumber: "JAF-OPEN",
						stage: "WAREHOUSE",
						waitingOn: "crew",
					}),
				],
			},
		})
		const card = screen
			.getByRole("heading", { level: 2, name: /My open work orders/ })
			.closest("section") as HTMLElement
		expect(
			within(card).getByRole("link", { name: "JAF-OPEN" }),
		).toHaveAttribute("href", "/docs/o1")
		expect(card).toHaveTextContent("Waiting on: crew")
	})

	it("says why a job is blocked", async ({ renderStub }) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				blocked: [
					queueRow({ id: "b1", blockReason: "billing_aviso_pdf" }),
					queueRow({ id: "b2", blockReason: "aviso_mismatch" }),
				],
			},
		})
		expect(screen.getByText("Billing: missing Aviso PDF")).toBeInTheDocument()
		expect(screen.getByText("Aviso ≠ invoice")).toBeInTheDocument()
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

	it("does not put the filter bar or the all-orders list on the dashboard", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			showFilters: true,
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
		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
		expect(screen.queryByText("All work orders")).not.toBeInTheDocument()
		expect(screen.queryByText("JAF-2026-1001")).not.toBeInTheDocument()
	})

	it("shows the filter bar on the All work orders view", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, { showFilters: true, stageQueue: "all" })
		expect(screen.getByRole("searchbox")).toBeInTheDocument()
	})

	it("keeps the filter bar off the other step views", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			showFilters: true,
			stageQueue: "invoice",
		})
		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
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

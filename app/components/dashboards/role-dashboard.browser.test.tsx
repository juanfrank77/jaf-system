import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RoleDashboard } from "./role-dashboard"

const base = { stats: [], alert: null, explainer: null, docs: [] }
const emptyQueues = {
	myOpen: [],
	intake: [],
	pendingReview: [],
	approved: [],
	missingAviso: [],
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
					name: "Dashboard",
				}),
			).toBeInTheDocument()
		})
	}

	it("renders the six supervisor queues and the work-order list for SUPERVISOR", async ({
		renderStub,
	}) => {
		await mount(renderStub, <RoleDashboard {...supervisor} {...base} />)
		expect(
			screen.getByRole("heading", { level: 1, name: "Dashboard" }),
		).toBeInTheDocument()
		// five queue cards (My open work orders last); dashboard no longer has an "All work orders" section
		const headings = screen.getAllByRole("heading", { level: 2 })
		expect(headings).toHaveLength(5)
		expect(screen.queryByText("Sent back to crew")).not.toBeInTheDocument()
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

	it("hides the Aviso number from the WAREHOUSE dashboard", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<RoleDashboard
				{...{ role: "WAREHOUSE" }}
				supervisorQueues={null}
				{...base}
				docs={[billedDoc]}
			/>,
		)
		// Warehouse works from its four queues only (mockup v3): no all-docs list.
		expect(screen.queryByText("JAF-1")).not.toBeInTheDocument()
		expect(screen.queryByText(/12345678/)).not.toBeInTheDocument()
	})

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
				stats={[{ labelKey: "dashboard.stat.total_documents", value: 9 }]}
				warehouseCounts={{ prep: 3, release: 2, returns: 4 }}
			/>,
		)
		expect(screen.getAllByText("Awaiting pickup")).toHaveLength(1)
		expect(screen.queryByText("Total documents")).not.toBeInTheDocument()
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
	"awaiting_warehouse",
	"awaiting_crew",
	"pending_review",
	"stage_awaiting_warehouse",
	"stage_awaiting_crew",
	"stage_pending_review",
	"stage_in_finance",
	"shortage_count",
	"overage_count",
	"aging_oldest_days",
	"aging_po_wait_count",
	"aging_claro_wait_count",
] as const
const twelveStats = statKeys.map((k, i) => ({
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
				stats={twelveStats}
				supervisorScope={{ areas: ["CENTRAL"], brigadeCount: 4 }}
				{...props}
			/>,
		)

	it("shows an Action needed card with days open for each Aviso discrepancy", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				actionNeeded: [
					{
						...queueRow({
							id: "d9",
							controlNumber: "JAF-DISC",
							stage: "PRECERT",
						}),
						daysOpen: 4,
					},
				],
			},
		})
		const card = screen
			.getByRole("heading", { level: 2, name: /Action needed/ })
			.closest("section") as HTMLElement
		expect(
			within(card).getByText(
				"Aviso differs from your work order. Reconcile with your Claro supervisor.",
			),
		).toBeVisible()
		expect(
			within(card).getByRole("link", { name: "JAF-DISC" }),
		).toHaveAttribute("href", "/docs/d9/review?step=AVISO")
		expect(within(card).getByText("Open 4 days")).toBeVisible()
	})

	it("puts a red Returned (n) box at the top with her note word for word and the way to the fix", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				returned: [
					queueRow({
						id: "back1",
						controlNumber: "MAINT261026004",
						stage: "RELEASE",
						openLabel: "RETURNED",
						note: "Aviso 10359868 lists 3 poles; the work order says 2.",
						since: new Date(),
					}),
				],
			},
		})
		const heading = screen.getByRole("heading", { level: 2, name: "Returned" })
		const card = heading.closest("section") as HTMLElement
		expect(within(card).getByText("1")).toBeVisible()
		expect(
			within(card).getByText(
				"Aviso 10359868 lists 3 poles; the work order says 2.",
			),
		).toBeVisible()
		expect(
			within(card).getByRole("link", { name: "MAINT261026004" }),
		).toHaveAttribute("href", "/docs/back1/review?step=AVISO")
		const chip = within(card).getByText("Returned", { selector: "span" })
		expect(chip).toHaveAttribute("data-variant", "danger")
		// At the top: before the tiles.
		const tiles = screen.getByTestId("supervisor-tiles")
		expect(
			card.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	it("has no Returned box when nothing was sent back", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: { ...emptyQueues, returned: [] },
		})
		expect(
			screen.queryByRole("heading", { level: 2, name: "Returned" }),
		).toBeNull()
	})

	it("has no Action needed card when no job has a discrepancy", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: { ...emptyQueues, actionNeeded: [] },
		})
		expect(
			screen.queryByRole("heading", { level: 2, name: /Action needed/ }),
		).toBeNull()
	})

	it("shows four working tiles and folds the nine accounting metrics", async ({
		renderStub,
	}) => {
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				missingAviso: [queueRow({ id: "b" }), queueRow({ id: "b2" })],
			},
		})
		const tiles = screen.getByTestId("supervisor-tiles")
		expect(tiles.querySelectorAll('[data-slot="stat"]')).toHaveLength(4)
		// the queue tiles carry the queue counts; nothing is "sent back" to a crew
		expect(within(tiles).queryByText("Sent back")).not.toBeInTheDocument()
		expect(
			within(tiles).getByText("Missing Aviso").nextSibling,
		).toHaveTextContent("2")
		const fold = screen.getByTestId("more-metrics")
		expect(fold.querySelectorAll('[data-slot="stat"]')).toHaveLength(9)
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
				intake: [
					queueRow({ id: "new1", controlNumber: "JAF-NEW", stage: "INTAKE" }),
				],
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
				{ labelKey: "dashboard.stat.awaiting_warehouse", value: 1 },
				{ labelKey: "dashboard.stat.awaiting_crew", value: 2 },
				{ labelKey: "dashboard.stat.pending_review", value: 3 },
			],
		})
		const tiles = screen.getByTestId("supervisor-tiles")
		const hrefOf = (label: string) =>
			within(tiles).getByText(label).closest("a")?.getAttribute("href")
		expect(hrefOf("Awaiting warehouse")).toBe("/dashboard?stage=intake")
		expect(hrefOf("Field work in progress")).toBe("/dashboard?stage=field")
		expect(hrefOf("Pending review")).toBe("/dashboard?stage=review")
		expect(hrefOf("Missing Aviso")).toMatch(/#missing-aviso$/)
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

	it("shows how long a row has been waiting and never flags quantity differences", async ({
		renderStub,
	}) => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		const oneDayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000)
		await mountSupervisor(renderStub, {
			supervisorQueues: {
				...emptyQueues,
				pendingReview: [queueRow({ since: twoHoursAgo })],
				approved: [queueRow({ id: "a", stage: "INVOICE", since: oneDayAgo })],
			},
		})
		expect(screen.getByText("Submitted 2h ago")).toBeInTheDocument()
		expect(screen.getByText("Signed off 1d ago")).toBeInTheDocument()
		expect(screen.queryByText("Qty discrepancy")).not.toBeInTheDocument()
	})
})

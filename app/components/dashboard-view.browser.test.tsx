import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardView } from "./dashboard-view"

const doc = (
	overrides: Partial<Parameters<typeof DashboardView>[0]["docs"][number]> = {},
) => ({
	id: "1",
	controlNumber: "JAF-10493",
	status: "CREATED" as const,
	jobType: "Installation",
	jobAddressEstimated: "Cupey, San Juan",
	createdAt: new Date("2026-07-01"),
	assignedCrewIds: [],
	sendBackHistory: null,
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
							stats={[{ labelKey: "dashboard.stat.open_documents", value: 3 }]}
							alert={null}
							explainer={null}
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
							alert={{
								variant: "warn",
								key: "dashboard.alert.awaiting_prep",
								count: 2,
							}}
							explainer={null}
							docs={[]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByText("2 documents waiting on your prep"),
		).toBeInTheDocument()
	})

	it("renders the alert pill in Spanish when the locale is es", async ({
		renderStub,
	}) => {
		await renderStub({
			i18n: { lng: "es" },
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.awaiting_prep",
								count: 2,
							}}
							explainer={null}
							docs={[]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByText("2 documentos esperando tu preparación"),
		).toBeInTheDocument()
	})

	it("omits the alert pill when null", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView stats={[]} alert={null} explainer={null} docs={[]} />
					),
				},
			],
		})
		expect(screen.queryByText(/waiting on your prep/)).not.toBeInTheDocument()
	})

	it("renders each document as a link with its status badge", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[doc({ id: "abc", status: "LC_REQUEST_GENERATED" })]}
						/>
					),
				},
			],
		})
		const link = screen.getByRole("link", { name: /JAF-10493/ })
		expect(link).toHaveAttribute("href", "/docs/abc")
		expect(screen.getByText("LC request generated")).toBeInTheDocument()
	})

	it("shows an empty state when there are no documents", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView stats={[]} alert={null} explainer={null} docs={[]} />
					),
				},
			],
		})
		expect(screen.getByText("No documents yet.")).toBeInTheDocument()
	})

	it("renders the Sent Back section with the latest send-back note", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							sentBackDocs={[
								doc({
									id: "sb1",
									status: "SIGNED",
									controlNumber: "JAF-10494",
									sendBackHistory: [
										{
											fromStatus: "FIELD_UPDATED",
											toStatus: "SIGNED",
											note: "Photo was blurry, please reshoot",
											byUserId: "sup1",
											createdAt: "2026-08-06T10:00:00Z",
										},
									],
								}),
							]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByText("Sent Back (1)", { exact: false }),
		).toBeInTheDocument()
		expect(screen.getByText("Needs Fix")).toBeInTheDocument()
		expect(
			screen.getByText(/Photo was blurry, please reshoot/),
		).toBeInTheDocument()
	})

	it("does not render the Sent Back section when empty", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							sentBackDocs={[]}
						/>
					),
				},
			],
		})
		expect(screen.queryByText("Sent Back")).not.toBeInTheDocument()
	})

	it("renders the Aviso # for documents that have one", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[doc({ id: "abc", avisoNumber: "10333185" })]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("Aviso # 10333185")).toBeInTheDocument()
	})

	it("renders the filter section with status, crew, and search placeholders", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							showFilters
							crewOptions={[{ id: "crew1", name: "Brigade Alpha" }]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("Filters")).toBeInTheDocument()
		expect(screen.getByText("All statuses")).toBeInTheDocument()
		expect(screen.getByText("All crews")).toBeInTheDocument()
		expect(screen.getByPlaceholderText(/Search by Aviso/)).toBeInTheDocument()
	})

	it("shows the clear-filters button only when filters are active", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							showFilters
							crewOptions={[]}
							selectedStatus="CREATED"
						/>
					),
				},
			],
		})
		expect(screen.getByText("Clear filters")).toBeInTheDocument()
	})

	it("hides the clear-filters button when no filters are active", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							crewOptions={[]}
						/>
					),
				},
			],
		})
		expect(screen.queryByText("Clear filters")).not.toBeInTheDocument()
	})

	it("renders crew My Jobs groupings", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							crewPreppedDocs={[doc({ id: "prepped", status: "PREPPED" })]}
							crewInFieldDocs={[doc({ id: "field", status: "SIGNED" })]}
							crewSentBackDocs={[
								doc({
									id: "sb",
									status: "SIGNED",
									sendBackHistory: [
										{
											fromStatus: "FIELD_UPDATED",
											toStatus: "SIGNED",
											note: "Retake photo",
											byUserId: "sup1",
											createdAt: "2026-08-13T10:00:00Z",
										},
									],
								}),
							]}
							crewSubmittedDocs={[doc({ id: "sub", status: "FIELD_UPDATED" })]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("Ready for Pickup (1)")).toBeInTheDocument()
		expect(screen.getByText("In the Field (1)")).toBeInTheDocument()
		expect(screen.getByText(/Retake photo/)).toBeInTheDocument()
		expect(screen.getByText("Submitted (1)")).toBeInTheDocument()
	})

	it("greets the user by first name and keeps the role stats next to the exec panels", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[
								{ labelKey: "dashboard.stat.total_documents", value: 12 },
							]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="ADMIN"
							userName="Monica García"
							greeting="morning"
							exec={{
								year: 2026,
								money: {
									sold: 2_490_000,
									poReceived: 2_007_589,
									open: 482_411,
									openPct: 19,
								},
								months: [
									{ month: 0, sold: 125_267, po: 125_318, avisos: 185 },
									{ month: 1, sold: 169_812, po: 167_902, avisos: 245 },
								],
								avisos: {
									count: 1838,
									noPo: 588,
									noPoPct: 32,
									receivablesOpen: 1840,
								},
								field: {
									inField: 27,
									bySupervisor: [
										{ name: "Rivera", count: 9 },
										{ name: "Ocasio", count: 8 },
									],
									installersTotal: 54,
									installersOnRoad: 31,
									paidThisWeek: 41_200,
									brigadesActive: 14,
									brigadesByArea: [{ name: "NORTE", count: 13 }],
								},
								warehouse: {
									requested: 1,
									pendingApproval: 2,
									approved: 0,
									ready: 0,
									byWarehouse: [{ name: "Guaynabo", count: 3 }],
								},
								attention: [
									{
										id: "po_short:a",
										kind: "po_short",
										level: "critical",
										href: "/docs/a",
										params: {
											aviso: "M17-10341818",
											diff: "314.66",
											sold: "8,271.91",
											po: "7,957.25",
										},
									},
									{
										id: "restock_approval",
										kind: "restock_approval",
										level: "watch",
										href: "/admin/restock",
										params: { count: 2 },
									},
								],
								shortPoCount: 1,
								collections: [
									{
										id: "a",
										controlNumber: "JAF-1",
										avisoNumber: "M17-10341818",
										brigadePaidAt: new Date(2026, 3, 29),
										sold: 8271.91,
										po: 7957.25,
										balance: -314.66,
										stage: "PO_RECEIVED_UPLOAD",
										problem: "po_short",
										daysOut: 143,
									},
								],
							}}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("heading", { name: /Good morning,\s*Monica/ }),
		).toBeInTheDocument()
		// KPI strip
		expect(screen.getByText("Waiting on Claro")).toBeInTheDocument()
		expect(screen.getAllByText("$482K").length).toBeGreaterThan(0)
		expect(screen.getByText("Avisos with no PO")).toBeInTheDocument()
		// Existing role stats are still shown
		expect(screen.getByText("Documents")).toBeInTheDocument()
		expect(screen.getByText("12")).toBeInTheDocument()
		// Panels
		expect(screen.getByText("Money out the door")).toBeInTheDocument()
		expect(screen.getByText("$482,411.00")).toBeInTheDocument()
		expect(
			screen.getByText("Aviso M17-10341818 came in $314.66 short"),
		).toBeInTheDocument()
		expect(
			screen.getByText("2 material requests are waiting for approval"),
		).toBeInTheDocument()
		expect(screen.getAllByText("2 items").length).toBeGreaterThan(0)
		expect(
			screen.getByRole("link", { name: "Review 1 short PO" }),
		).toHaveAttribute("href", "/finance/receivables?stage=PO_RECEIVED_UPLOAD")
		expect(screen.getByText("Collections")).toBeInTheDocument()
		expect(screen.getByText("-314.66")).toBeInTheDocument()
		expect(screen.getByText("143")).toBeInTheDocument()
	})

	it("warehouse layout renders KPI helpers, table headers, and doc links", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[
								{ labelKey: "dashboard.stat.pending_preps", value: 1 },
								{
									labelKey: "dashboard.stat.prepped_awaiting_pickup",
									value: 0,
								},
								{ labelKey: "dashboard.stat.missing_materials", value: 0 },
								{ labelKey: "dashboard.stat.returns_to_log", value: 0 },
								{
									labelKey: "dashboard.stat.stage_awaiting_warehouse",
									value: 1,
								},
								{ labelKey: "dashboard.stat.stage_awaiting_crew", value: 0 },
								{
									labelKey: "dashboard.stat.stage_pending_review",
									value: 0,
								},
								{ labelKey: "dashboard.stat.stage_in_finance", value: 0 },
								{ labelKey: "dashboard.stat.discrepancy_count", value: 0 },
								{ labelKey: "dashboard.stat.shortage_count", value: 0 },
								{ labelKey: "dashboard.stat.overage_count", value: 0 },
							]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.awaiting_prep",
								count: 1,
							}}
							explainer={null}
							docs={[
								doc({
									id: "abc",
									status: "CREATED",
									controlNumber: "JAF-10493",
									avisoNumber: "10333185",
								}),
							]}
							userRole="WAREHOUSE"
							userName="Demo User"
							greeting="morning"
						/>
					),
				},
			],
		})
		expect(screen.getByText("Pending Preps")).toBeInTheDocument()
		expect(screen.getByText("Needs your attention")).toBeInTheDocument()
		expect(screen.getByText("No discrepancies")).toBeInTheDocument()
		expect(
			screen.getByText("1 document waiting on your prep"),
		).toBeInTheDocument()
		expect(screen.getByText("Doc #")).toBeInTheDocument()
		expect(screen.getByText("Type")).toBeInTheDocument()
		expect(screen.getByText("Aviso # 10333185")).toBeInTheDocument()
		const docLinks = screen.getAllByRole("link", { name: /JAF-10493/ })
		expect(docLinks[0]).toHaveAttribute("href", "/docs/abc")
		expect(
			screen.getByRole("link", { name: "1 document waiting on your prep" }),
		).toHaveAttribute("href", "/docs/abc/prep")
	})

	it("warehouse layout renders the missing-materials alert", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.missing_materials",
								count: 2,
							}}
							explainer={null}
							docs={[]}
							userRole="WAREHOUSE"
							warehouseMissingDocs={[doc({ id: "miss1", status: "CREATED" })]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "2 jobs have missing materials" }),
		).toHaveAttribute("href", "/docs/miss1/prep")
	})

	it("warehouse layout renders restock requests and the empty documents state", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="WAREHOUSE"
							restockRequests={[
								{
									id: "restock-abcdef",
									status: "REQUESTED",
									createdAt: new Date("2026-09-18"),
									requestedBy: { name: "Alex Installer" },
									warehouse: { name: "Guaynabo" },
									items: [],
								},
							]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("No documents yet.")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /#abcdef/ })).toHaveAttribute(
			"href",
			"/restock/restock-abcdef/fulfill",
		)
		expect(screen.getByText("Alex Installer — Guaynabo")).toBeInTheDocument()
	})

	it("warehouse layout shows compact search and clear-all when filters are on", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="WAREHOUSE"
							showFilters
							selectedStatus="CREATED"
							searchFilter="Cupey"
						/>
					),
				},
			],
		})
		expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument()
		expect(screen.getByText("Clear filters")).toBeInTheDocument()
		expect(screen.getByText("All job types")).toBeInTheDocument()
		expect(screen.queryByText("All crews")).not.toBeInTheDocument()
	})

	it("warehouse layout renders the alert in Spanish", async ({
		renderStub,
	}) => {
		await renderStub({
			i18n: { lng: "es" },
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.awaiting_prep",
								count: 2,
							}}
							explainer={null}
							docs={[]}
							userRole="WAREHOUSE"
						/>
					),
				},
			],
		})
		expect(
			screen.getByText("2 documentos esperando tu preparación"),
		).toBeInTheDocument()
	})

	const crewStats = [
		{ labelKey: "dashboard.stat.open_jobs" as const, value: 4 },
		{ labelKey: "dashboard.stat.ready_for_pickup" as const, value: 1 },
		{ labelKey: "dashboard.stat.in_the_field" as const, value: 1 },
		{ labelKey: "dashboard.stat.sent_back" as const, value: 1 },
		{ labelKey: "dashboard.stat.submitted" as const, value: 1 },
		{ labelKey: "dashboard.stat.stage_awaiting_warehouse" as const, value: 0 },
		{ labelKey: "dashboard.stat.stage_awaiting_crew" as const, value: 1 },
		{ labelKey: "dashboard.stat.stage_pending_review" as const, value: 0 },
		{ labelKey: "dashboard.stat.stage_in_finance" as const, value: 0 },
		{ labelKey: "dashboard.stat.discrepancy_count" as const, value: 0 },
		{ labelKey: "dashboard.stat.shortage_count" as const, value: 0 },
		{ labelKey: "dashboard.stat.overage_count" as const, value: 0 },
	]

	it("crew layout renders KPI titles and helpers", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={crewStats}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="CREW"
							userName="Demo Crew"
						/>
					),
				},
			],
		})
		expect(screen.getByText("Open Jobs")).toBeInTheDocument()
		expect(screen.getByText("Jobs assigned to you")).toBeInTheDocument()
		expect(screen.getByText("Ready for Pickup")).toBeInTheDocument()
		expect(screen.getAllByText("Pick up and sign").length).toBeGreaterThan(0)
		expect(screen.getByText("In the Field")).toBeInTheDocument()
		expect(screen.getByText("Update field status")).toBeInTheDocument()
		expect(screen.getByText("Sent Back")).toBeInTheDocument()
		expect(screen.getByText("Needs a fix")).toBeInTheDocument()
		expect(screen.getByText("Submitted")).toBeInTheDocument()
		expect(screen.getByText("Awaiting review")).toBeInTheDocument()
		expect(screen.getByText("No discrepancies")).toBeInTheDocument()
		expect(
			screen.queryByText("Ready for crew assignment"),
		).not.toBeInTheDocument()
	})

	it("crew layout links the sent-back alert to the first sent-back job", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.sent_back",
								count: 1,
							}}
							explainer={null}
							docs={[]}
							userRole="CREW"
							crewSentBackDocs={[doc({ id: "sb1", status: "SIGNED" })]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "1 job sent back" }),
		).toHaveAttribute("href", "/docs/sb1/field")
	})

	it("crew layout links the submitted alert to the first submitted job", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "info",
								key: "dashboard.alert.submitted",
								count: 2,
							}}
							explainer={null}
							docs={[]}
							userRole="CREW"
							crewSubmittedDocs={[doc({ id: "sub1", status: "FIELD_UPDATED" })]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "2 jobs submitted" }),
		).toHaveAttribute("href", "/docs/sub1")
	})

	it("crew layout links the ready-for-pickup alert to sign", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "info",
								key: "dashboard.alert.ready_for_pickup",
								count: 1,
							}}
							explainer={null}
							docs={[]}
							userRole="CREW"
							crewPreppedDocs={[doc({ id: "prep1", status: "PREPPED" })]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "1 job ready for pickup" }),
		).toHaveAttribute("href", "/docs/prep1/sign")
	})

	it("crew layout links the jobs-in-field alert to field", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.jobs_in_field",
								count: 1,
							}}
							explainer={null}
							docs={[]}
							userRole="CREW"
							crewInFieldDocs={[doc({ id: "field1", status: "SIGNED" })]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "1 job in the field" }),
		).toHaveAttribute("href", "/docs/field1/field")
	})

	it("crew layout renders queues with badges, notes, and links", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="CREW"
							crewPreppedDocs={[
								doc({
									id: "prepped",
									status: "PREPPED",
									controlNumber: "JAF-P",
								}),
							]}
							crewInFieldDocs={[
								doc({ id: "field", status: "SIGNED", controlNumber: "JAF-F" }),
							]}
							crewSentBackDocs={[
								doc({
									id: "sb",
									status: "SIGNED",
									controlNumber: "JAF-SB",
									sendBackHistory: [
										{
											fromStatus: "FIELD_UPDATED",
											toStatus: "SIGNED",
											note: "Retake photo",
											byUserId: "sup1",
											createdAt: "2026-08-13T10:00:00Z",
										},
									],
								}),
							]}
							crewSubmittedDocs={[
								doc({
									id: "sub",
									status: "FIELD_UPDATED",
									controlNumber: "JAF-SUB",
								}),
							]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("Ready for Pickup (1)")).toBeInTheDocument()
		expect(screen.getByText("In the Field (1)")).toBeInTheDocument()
		expect(screen.getByText("Sent Back (1)")).toBeInTheDocument()
		expect(screen.getByText("Submitted (1)")).toBeInTheDocument()
		expect(screen.getByText("Needs Fix")).toBeInTheDocument()
		expect(screen.getByText(/Retake photo/)).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /JAF-P/ })).toHaveAttribute(
			"href",
			"/docs/prepped/sign",
		)
		expect(screen.getByRole("link", { name: /JAF-F/ })).toHaveAttribute(
			"href",
			"/docs/field/field",
		)
		expect(screen.getByRole("link", { name: /JAF-SB/ })).toHaveAttribute(
			"href",
			"/docs/sb/field",
		)
		expect(screen.getByRole("link", { name: /JAF-SUB/ })).toHaveAttribute(
			"href",
			"/docs/sub",
		)
	})

	it("crew layout renders recent-docs table headers, aviso, signals, and empty state", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[
								doc({
									id: "abc",
									avisoNumber: "10333185",
									estimatedMaterials: [{ serviceCodeId: "sc1", qty: 1 }],
									materialsTaken: [{ serviceCodeId: "sc1", qty: 2 }],
								}),
							]}
							userRole="CREW"
						/>
					),
				},
			],
		})
		expect(screen.getByText("Doc #")).toBeInTheDocument()
		expect(screen.getByText("Type")).toBeInTheDocument()
		expect(screen.getByText("Aviso # 10333185")).toBeInTheDocument()
		expect(screen.getByText("Overage")).toBeInTheDocument()
		expect(screen.getByText("Tap card to review →")).toBeInTheDocument()
		const docLinks = screen.getAllByRole("link", { name: /JAF-10493/ })
		expect(docLinks[0]).toHaveAttribute("href", "/docs/abc")
	})

	it("crew layout shows the empty documents state", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="CREW"
						/>
					),
				},
			],
		})
		expect(screen.getByText("No documents yet.")).toBeInTheDocument()
	})

	it("crew layout shows compact search and clear-all without a crew dropdown", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							userRole="CREW"
							showFilters
							selectedStatus="CREATED"
							searchFilter="Cupey"
							crewOptions={[{ id: "crew1", name: "Brigade Alpha" }]}
						/>
					),
				},
			],
		})
		expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument()
		expect(screen.getByText("Clear filters")).toBeInTheDocument()
		expect(screen.queryByText("All crews")).not.toBeInTheDocument()
		expect(screen.queryByText("Filters")).not.toBeInTheDocument()
	})

	it("crew layout renders the alert in Spanish", async ({ renderStub }) => {
		await renderStub({
			i18n: { lng: "es" },
			entries: [
				{
					path: "/",
					Component: () => (
						<DashboardView
							stats={[]}
							alert={{
								variant: "warn",
								key: "dashboard.alert.sent_back",
								count: 1,
							}}
							explainer={null}
							docs={[]}
							userRole="CREW"
						/>
					),
				},
			],
		})
		expect(screen.getByText("1 trabajo devuelto")).toBeInTheDocument()
	})
})

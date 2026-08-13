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
					Component: () => <DashboardView stats={[]} alert={null} docs={[]} />,
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

	it("shows an empty state when there are no documents", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <DashboardView stats={[]} alert={null} docs={[]} />,
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
							docs={[]}
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
							docs={[]}
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
						<DashboardView stats={[]} alert={null} docs={[]} crewOptions={[]} />
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
})

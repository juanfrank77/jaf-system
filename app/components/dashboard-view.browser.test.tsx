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
})

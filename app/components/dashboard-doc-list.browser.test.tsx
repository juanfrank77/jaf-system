import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardDocList, type DashboardDocRow } from "./dashboard-doc-list"

const doc: DashboardDocRow = {
	id: "d1",
	controlNumber: "JAF-1",
	status: "CLARO_UPLOADED",
	jobType: "Install",
	jobAddressEstimated: "Calle 1",
	createdAt: new Date("2026-10-01T12:00:00Z"),
	avisoNumber: "12345678",
}

const mount = (renderStub: any, ui: React.ReactElement, lng?: "en" | "es") =>
	renderStub({
		entries: [{ path: "/", Component: () => ui }],
		i18n: lng ? { lng } : undefined,
	})

describe("DashboardDocList billing visibility", () => {
	it("shows the raw status and the Aviso number by default", async ({
		renderStub,
	}) => {
		await mount(renderStub, <DashboardDocList docs={[doc]} />)
		expect(screen.getByText("CLARO UPLOADED")).toBeInTheDocument()
		expect(screen.getByText(/12345678/)).toBeInTheDocument()
	})

	it("hides billing details and plain-labels the status when showBilling is false", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList docs={[doc]} showBilling={false} />,
		)
		expect(screen.getByText("Approved")).toBeInTheDocument()
		expect(screen.queryByText(/12345678/)).not.toBeInTheDocument()
		expect(screen.queryByText(/CLARO/)).not.toBeInTheDocument()
	})

	it("localizes the plain status to Spanish", async ({ renderStub }) => {
		await mount(
			renderStub,
			<DashboardDocList docs={[doc]} showBilling={false} />,
			"es",
		)
		expect(screen.getByText("Aprobado")).toBeInTheDocument()
	})

	it("falls back to the raw status for a value with no label", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				docs={[{ ...doc, status: "FUTURE_STATUS" as never }]}
				showBilling={false}
			/>,
		)
		expect(screen.getByText("FUTURE STATUS")).toBeInTheDocument()
	})
})

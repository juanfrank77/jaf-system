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
	it("labels the status with the current step and shows the Aviso number by default", async ({
		renderStub,
	}) => {
		await mount(renderStub, <DashboardDocList docs={[doc]} />)
		expect(screen.getByText("JAF invoice")).toBeInTheDocument()
		expect(screen.queryByText(/CLARO/)).not.toBeInTheDocument()
		expect(screen.getByText(/12345678/)).toBeInTheDocument()
	})

	it("uses the same step label for every role and hides billing details when showBilling is false", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList docs={[doc]} showBilling={false} />,
		)
		expect(screen.getByText("JAF invoice")).toBeInTheDocument()
		expect(screen.queryByText(/12345678/)).not.toBeInTheDocument()
	})

	it("prefers the server-derived stage and localizes it to Spanish", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList docs={[{ ...doc, stage: "PRECERT" }]} />,
			"es",
		)
		expect(screen.getByText("Hoja pre-cert.")).toBeInTheDocument()
	})
})

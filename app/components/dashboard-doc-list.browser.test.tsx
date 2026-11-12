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
		expect(screen.getByText("Packet → Claro")).toBeInTheDocument()
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
		expect(screen.getByText("Packet → Claro")).toBeInTheDocument()
		expect(screen.queryByText(/12345678/)).not.toBeInTheDocument()
	})

	it("names the Claro supervisor under the job line when the row has one", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				docs={[{ ...doc, claroSupervisor: { name: "Ramón Claro" } }]}
			/>,
		)
		expect(
			screen.getByText(/Claro supervisor: Ramón Claro/),
		).toBeInTheDocument()
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

	it("prefers the finer open-job label over the stage label", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				docs={[{ ...doc, stage: "FIELD", openLabel: "PICKED_UP" }]}
			/>,
			"es",
		)
		expect(screen.getByText("Recogido")).toBeInTheDocument()
	})

	it("Packets to Claro: flags each row sent or not sent from the first-send timestamp", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				packetStatus
				docs={[
					{
						...doc,
						id: "sent",
						controlNumber: "JAF-SENT",
						status: "SUPERVISOR_APPROVED",
						jafInvoiceGeneratedAt: new Date("2026-10-18T12:00:00Z"),
					},
					{
						...doc,
						id: "unsent",
						controlNumber: "JAF-UNSENT",
						status: "SUPERVISOR_APPROVED",
						jafInvoiceGeneratedAt: null,
					},
				]}
			/>,
		)
		const sentRow = screen.getByText("JAF-SENT").closest("a") as HTMLElement
		const unsentRow = screen.getByText("JAF-UNSENT").closest("a") as HTMLElement
		expect(sentRow.textContent).toMatch(/Sent \d/)
		expect(sentRow.textContent).not.toContain("Not sent")
		expect(unsentRow.textContent).toContain("Not sent")
	})

	it("shows no packet flag on the other lists", async ({ renderStub }) => {
		await mount(
			renderStub,
			<DashboardDocList docs={[{ ...doc, jafInvoiceGeneratedAt: null }]} />,
		)
		expect(screen.queryByText("Not sent")).toBeNull()
	})
})

describe("DashboardDocList step links for a returned packet", () => {
	it("opens the Aviso step for a returned packet and the job's own step otherwise", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				stepLinks
				docs={[
					{ ...doc, id: "back", stage: "RELEASE", openLabel: "RETURNED" },
					{
						...doc,
						id: "ready",
						controlNumber: "JAF-2",
						stage: "RELEASE",
						openLabel: "RELEASE",
					},
				]}
			/>,
		)
		expect(screen.getByText("JAF-1").closest("a")).toHaveAttribute(
			"href",
			"/docs/back/review?step=AVISO",
		)
		expect(screen.getByText("JAF-2").closest("a")).toHaveAttribute(
			"href",
			"/docs/ready/review?step=RELEASE",
		)
		expect(screen.getByText("Returned")).toHaveAttribute(
			"data-variant",
			"danger",
		)
	})
})

describe("DashboardDocList Finance and Admin chips for returned packets (S4)", () => {
	const released = {
		...doc,
		releasedToFinanceAt: new Date("2026-10-26T14:00:00Z"),
	}
	const ret = {
		note: "Fix the Aviso",
		byUserId: "u1",
		createdAt: "2026-10-27T14:00:00.000Z",
	}

	it("shows the red Returned chip, never a Finance step, for a returned packet", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				financeSteps
				docs={[
					{
						...released,
						openLabel: "RETURNED",
						financeSendBackNotes: [ret],
					},
				]}
			/>,
		)
		expect(screen.getByText("Returned")).toBeInTheDocument()
		expect(screen.queryByText("Packets in")).not.toBeInTheDocument()
		expect(screen.queryByText("Release")).not.toBeInTheDocument()
	})

	it("adds a Resent chip next to the Finance step once the supervisor resent it", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				financeSteps
				docs={[
					{
						...released,
						financeSendBackNotes: [
							{ ...ret, resentAt: "2026-10-28T10:00:00.000Z" },
						],
					},
				]}
			/>,
			"es",
		)
		expect(screen.getByText("Reenviado")).toBeInTheDocument()
		expect(screen.queryByText("Devuelto")).not.toBeInTheDocument()
	})

	it("drops the Resent chip once Finance has verified the packet", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DashboardDocList
				financeSteps
				docs={[
					{
						...released,
						financeVerifiedAt: new Date("2026-10-29T10:00:00Z"),
						financeSendBackNotes: [
							{ ...ret, resentAt: "2026-10-28T10:00:00.000Z" },
						],
					},
				]}
			/>,
		)
		expect(screen.queryByText("Resent")).not.toBeInTheDocument()
	})
})

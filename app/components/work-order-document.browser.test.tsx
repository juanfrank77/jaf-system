import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { WorkOrderDocument } from "~/lib/work-order-document"
import { GeneratePackage, WorkOrderDocumentCard } from "./work-order-document"

const SIG = "data:image/png;base64,iVBORw0KGgo="

const wo = (over: Partial<WorkOrderDocument> = {}): WorkOrderDocument => ({
	workOrderNumber: "MAINT-261019-001",
	claroSupervisor: "Ana Rivera",
	jafSupervisor: "Edgard Ocasio",
	crews: [{ name: "JESUS MARTINEZ", contractNumber: "009" }],
	address:
		"Bo. Juan Martín, Carr. 906 Km 2.1, Frente a la escuela, 18.05, -65.88, Aéreo, Yabucoa, Cobre, G1",
	description: "Pole transfer, three drops",
	services: [{ code: "34006301", description: "TRANSFER ATTCH", qty: 5 }],
	materials: [
		{ name: "CABLE", used: 40, unit: "FT", source: "WAREHOUSE_ISSUE" },
		{ name: "CLAMP", used: 3, unit: "EA", source: "TRUCK_STOCK" },
	],
	materialsFromWarehouse: true,
	materialsReason: null,
	fieldReport: "Two drops replaced.",
	signatures: {
		supervisor: { name: "Edgard Ocasio", image: SIG },
		warehouse: "pending",
		crew: "pending",
	},
	...over,
})

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("WorkOrderDocumentCard", () => {
	it("shows the header: title, number, issuer JAF and the date", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo()}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		expect(screen.getByText("JAF Work Order")).toBeInTheDocument()
		expect(screen.getAllByText("MAINT-261019-001").length).toBeGreaterThan(0)
		expect(screen.getByText("JAF")).toBeInTheDocument()
		expect(screen.getByText("10/19/2026")).toBeInTheDocument()
	})

	it("renders the blocks in the B5 order, without prices or Difference", async ({
		renderStub,
	}) => {
		const { container } = await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo()}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		const blocks = [...document.querySelectorAll("[data-block]")].map((el) =>
			el.getAttribute("data-block"),
		)
		expect(blocks).toEqual([
			"workOrderNumber",
			"claroSupervisor",
			"jafSupervisor",
			"crews",
			"address",
			"description",
			"services",
			"materials",
			"fieldReport",
			"signatures",
		])
		const text = (container ?? document.body).textContent ?? ""
		expect(document.body.textContent).not.toMatch(/[$€]|Difference/)
		expect(text).not.toMatch(/Job location/)
	})

	it("prints the crew as NAME · contract number, every crew of a shared job", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo({
					crews: [
						{ name: "JESUS MARTINEZ", contractNumber: "009" },
						{ name: "LUIS ORTIZ", contractNumber: "014" },
					],
				})}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		expect(screen.getByText("JESUS MARTINEZ · 009")).toBeInTheDocument()
		expect(screen.getByText("LUIS ORTIZ · 014")).toBeInTheDocument()
	})

	it("shows the whole address and each material's Source", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo()}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		expect(screen.getByText(wo().address)).toBeInTheDocument()
		expect(screen.getByText("Warehouse issue")).toBeInTheDocument()
		expect(screen.getByText("Truck stock")).toBeInTheDocument()
	})

	it("shows Pending for missing warehouse and crew signatures, and no Prefield, Photos or Blueprint block", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo()}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		expect(screen.getAllByText("Pending")).toHaveLength(2)
		for (const heading of ["Prefield", "Pictures", "Blueprint"])
			expect(screen.queryByRole("heading", { name: heading })).toBeNull()
	})

	it("a no-warehouse job shows the reason under Materials and no pickup signatures", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WorkOrderDocumentCard
				document={wo({
					materialsFromWarehouse: false,
					materialsReason: "own truck",
				})}
				issuedOn="2026-10-19T15:00:00.000Z"
			/>,
		)
		const materials = document.querySelector('[data-block="materials"]')
		expect(materials?.textContent).toContain("own truck")
		expect(materials?.textContent).toContain("Not from the warehouse")
		expect(screen.queryByText("Pending")).toBeNull()
		expect(screen.queryByText("Warehouse")).toBeNull()
	})
})

describe("GeneratePackage", () => {
	it("is disabled until the supervisor has signed", async ({ renderStub }) => {
		await mount(renderStub, <GeneratePackage enabled={false} pdfHref={null} />)
		expect(
			screen.getByRole("button", { name: "Generate package" }),
		).toBeDisabled()
		expect(
			screen.queryByRole("link", { name: /Continue to step 5/ }),
		).toBeNull()
	})

	it("is enabled once signed; after generating it links the PDF and Continue to step 5", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<GeneratePackage
				enabled
				pdfHref="/files/packets/wo.pdf"
				continueHref="/docs/d1/review?step=INVOICE"
			/>,
		)
		expect(
			screen.getByRole("button", { name: "Generate package" }),
		).toBeEnabled()
		expect(screen.getByRole("link", { name: /Download PDF/ })).toHaveAttribute(
			"href",
			"/files/packets/wo.pdf",
		)
		expect(
			screen.getByRole("link", { name: /Continue to step 5/ }),
		).toHaveAttribute("href", "/docs/d1/review?step=INVOICE")
	})
})

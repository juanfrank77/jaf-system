import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import type { WorkOrderDocument } from "~/lib/work-order-document"
import {
	type ClaroPacketInput,
	generateClaroPacketPdf,
} from "./claro-packet.server"

// 1x1 transparent PNG.
const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
const SIG = `data:image/png;base64,${PNG_B64}`

async function textOf(pdf: Buffer): Promise<string> {
	const doc = await getDocumentProxy(new Uint8Array(pdf))
	const { text } = await extractText(doc, { mergePages: true })
	return text
}

function document(over: Partial<WorkOrderDocument> = {}): WorkOrderDocument {
	return {
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
			{ name: "CONNECTOR", used: 1, unit: null, source: "CLARO_DROP_OFF" },
		],
		materialsFromWarehouse: true,
		materialsReason: null,
		fieldReport: "Two drops replaced.",
		signatures: {
			supervisor: { name: "Edgard Ocasio", image: SIG },
			warehouse: { name: "Wanda Almacen", image: SIG },
			crew: { name: "JESUS MARTINEZ", image: SIG },
		},
		...over,
	}
}

function input(
	over: Partial<WorkOrderDocument> = {},
	showPickupSignatures = true,
): ClaroPacketInput {
	return {
		document: document(over),
		issuedOn: new Date("2026-10-19T15:00:00Z"),
		showPickupSignatures,
	}
}

describe("generateClaroPacketPdf (the JAF work order)", () => {
	it("prints the document header and every block, issued by JAF", async () => {
		const text = await textOf(await generateClaroPacketPdf(input()))
		expect(text).toContain("JAF Work Order")
		expect(text).toContain("JAF")
		expect(text).not.toContain("IMS")
		expect(text).toContain("MAINT-261019-001")
		expect(text).toContain("10/19/2026")
		expect(text).toContain("Ana Rivera")
		expect(text).toContain("Edgard Ocasio")
		expect(text).toContain("JESUS MARTINEZ · 009")
		expect(text).toContain("Frente a la escuela")
		expect(text).toContain("Cobre, G1")
		expect(text).toContain("Pole transfer, three drops")
		expect(text).toContain("34006301")
		expect(text).toContain("TRANSFER ATTCH")
		expect(text).toContain("CABLE")
		expect(text).toContain("Two drops replaced.")
	})

	it("prints each material's Source, every Source included", async () => {
		const text = await textOf(await generateClaroPacketPdf(input()))
		expect(text).toContain("Warehouse issue")
		expect(text).toContain("Truck stock")
		expect(text).toContain("Claro drop-off")
		expect(text).toContain("CLAMP")
	})

	it("has no currency symbol and no Difference column", async () => {
		const text = await textOf(await generateClaroPacketPdf(input()))
		expect(text).not.toMatch(/[$€]/)
		expect(text).not.toMatch(/Difference|Diferencia/)
		expect(text).not.toMatch(/Returned|Devuelto/)
	})

	it("prints Pending for a missing warehouse or crew signature", async () => {
		const text = await textOf(
			await generateClaroPacketPdf(
				input({
					signatures: {
						supervisor: { name: "Edgard Ocasio", image: SIG },
						warehouse: "pending",
						crew: "pending",
					},
				}),
			),
		)
		expect(text.match(/Pending/g)?.length).toBe(2)
	})

	it("lists every crew of a shared job", async () => {
		const text = await textOf(
			await generateClaroPacketPdf(
				input({
					crews: [
						{ name: "JESUS MARTINEZ", contractNumber: "009" },
						{ name: "LUIS ORTIZ", contractNumber: "014" },
					],
				}),
			),
		)
		expect(text).toContain("JESUS MARTINEZ · 009")
		expect(text).toContain("LUIS ORTIZ · 014")
	})

	it("has no Prefield, Blueprint or Photos section: those travel as their own files", async () => {
		const text = await textOf(await generateClaroPacketPdf(input()))
		expect(text).not.toContain("Prefield")
		expect(text).not.toMatch(/Blueprint|Plano/)
		expect(text).not.toMatch(/Photos|Fotos/)
	})

	it("prints the pickup signatures only on the warehouse path", async () => {
		const withPickup = await textOf(await generateClaroPacketPdf(input()))
		expect(withPickup).toContain("Pickup signatures")
		const without = await textOf(await generateClaroPacketPdf(input({}, false)))
		expect(without).not.toContain("Pickup signatures")
		expect(without).not.toContain("Pending")
	})

	it("prints the supervisor's reason under Materials on a no-warehouse job", async () => {
		const text = await textOf(
			await generateClaroPacketPdf(
				input(
					{ materialsFromWarehouse: false, materialsReason: "own truck" },
					false,
				),
			),
		)
		expect(text).toContain("own truck")
		expect(text.indexOf("own truck")).toBeGreaterThan(text.indexOf("Materials"))
		expect(text.indexOf("own truck")).toBeLessThan(text.indexOf("Field report"))
	})
})

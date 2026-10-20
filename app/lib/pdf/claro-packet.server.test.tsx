import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
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
const PNG = Buffer.from(PNG_B64, "base64")
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
		photos: { before: [], during: [], after: [] },
		blueprint: "not_required",
		prefield: {
			ordenNumber: "ORD-77",
			pedido: "PED-12",
			smr: "SMR-9",
			titulo: "Poste caído",
		},
		fieldReport: "Two drops replaced.",
		signatures: {
			supervisor: { name: "Edgard Ocasio", image: SIG },
			warehouse: { name: "Wanda Almacen", image: SIG },
			crew: { name: "JESUS MARTINEZ", image: SIG },
		},
		...over,
	}
}

function input(over: Partial<WorkOrderDocument> = {}): ClaroPacketInput {
	return {
		document: document(over),
		issuedOn: new Date("2026-10-19T15:00:00Z"),
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
		expect(text).toContain("SMR-9")
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

	it("says Prefield and blueprint are not required when the Claro supervisor does not require them", async () => {
		const text = await textOf(
			await generateClaroPacketPdf(input({ prefield: "not_required" })),
		)
		expect(text).not.toContain("SMR-9")
		expect(text).toContain("Not required by this Claro supervisor")
		expect(text).toContain("Not required")
	})

	it("embeds photos and image blueprints, skipping missing files", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "packet-"))
		const photo = path.join(dir, "before.png")
		const blueprint = path.join(dir, "plan.png")
		await writeFile(photo, PNG)
		await writeFile(blueprint, PNG)
		const pdf = await generateClaroPacketPdf(
			input({
				photos: {
					before: [photo, path.join(dir, "missing.png")],
					during: [],
					after: [],
				},
				blueprint: [blueprint, path.join(dir, "gone.pdf")],
			}),
		)
		const text = await textOf(pdf)
		expect(text).toContain("Antes")
		expect(text).toContain("Plano")
	})
})

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import {
	type ClaroPacketInput,
	generateClaroPacketPdf,
} from "./claro-packet.server"

// 1x1 transparent PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
)

async function textOf(pdf: Buffer): Promise<string> {
	const doc = await getDocumentProxy(new Uint8Array(pdf))
	const { text } = await extractText(doc, { mergePages: true })
	return text
}

function input(extra: Partial<ClaroPacketInput> = {}): ClaroPacketInput {
	return {
		controlNumber: "MAINT-261018-001",
		claroSupervisorName: "Ana Rivera",
		showPrefield: true,
		prefield: {
			avisoNumber: null,
			ordenNumber: "ORD-77",
			pedido: "PED-12",
			smr: "SMR-9",
			titulo: "Poste caído",
			description: "Transfer attachments",
		},
		address: {
			direccion1: "Calle 1",
			direccion2: null,
			sector: "Bo. Juan Martín",
			ciudad: "Yabucoa",
			latitud: "18.05",
			longitud: "-65.88",
			tipo: "Aéreo",
			tipoPlanta: "Cobre",
			grupoPlan: "G1",
		},
		workSummary: [
			{ claroCode: "34006301", name: "TRANSFER ATTCH", qty: 5, unit: "EA" },
		],
		materials: [
			{
				claroCode: "11000001",
				name: "CABLE",
				unit: "FT",
				used: 40,
				returned: 2,
				source: "WAREHOUSE",
			},
		],
		photos: { BEFORE: [], DURING: [], AFTER: [] },
		blueprints: [],
		supervisorName: "Sup One",
		signedOffAt: new Date("2026-10-18T12:00:00Z"),
		...extra,
	}
}

describe("generateClaroPacketPdf", () => {
	it("renders a bilingual packet naming IMS, with no prices", async () => {
		const pdf = await generateClaroPacketPdf(input())
		expect(pdf.length).toBeGreaterThan(0)
		const text = await textOf(pdf)
		expect(text).toContain("IMS")
		expect(text).toContain("Resumen del trabajo")
		expect(text).toContain("Work summary")
		expect(text).toContain("SMR-9")
		expect(text).not.toContain("$")
	})

	it("leaves the Prefield page out when not required", async () => {
		const text = await textOf(
			await generateClaroPacketPdf(input({ showPrefield: false })),
		)
		expect(text).not.toContain("SMR")
		expect(text).toContain("Resumen del trabajo")
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
					BEFORE: [photo, path.join(dir, "missing.png")],
					DURING: [],
					AFTER: [],
				},
				blueprints: [blueprint, path.join(dir, "gone.pdf")],
			}),
		)
		const text = await textOf(pdf)
		expect(text).toContain("Antes")
		expect(text).toContain("Plano")
	})
})

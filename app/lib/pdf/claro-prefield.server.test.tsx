import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import {
	type ClaroPrefieldInput,
	generateClaroPrefieldPdf,
} from "./claro-prefield.server"

async function textOf(pdf: Buffer): Promise<string> {
	const doc = await getDocumentProxy(new Uint8Array(pdf))
	const { text } = await extractText(doc, { mergePages: true })
	return text
}

const input = (over: Partial<ClaroPrefieldInput> = {}): ClaroPrefieldInput => ({
	workOrderNumber: "MAINT-261019-001",
	address: "Bo. Juan Martín, Carr. 906 Km 2.1, Yabucoa",
	title: "Pole transfer, three drops",
	jafSupervisor: "Edgard Ocasio",
	deptNumber: "OESTE",
	claroSupervisor: "Ana Rivera",
	issuedOn: new Date("2026-10-19T15:00:00Z"),
	...over,
})

describe("generateClaroPrefieldPdf (the Claro Prefield, JAF part filled in)", () => {
	it("fills in what JAF knows and prints Claro's four boxes as labels", async () => {
		const pdf = await generateClaroPrefieldPdf(input())
		const text = await textOf(pdf)
		expect(text).toContain("Prefield")
		expect(text).toContain("MAINT-261019-001")
		expect(text).toContain("Carr. 906 Km 2.1")
		expect(text).toContain("Pole transfer, three drops")
		expect(text).toContain("Edgard Ocasio")
		expect(text).toContain("Dept #")
		expect(text).toContain("OESTE")
		expect(text).toContain("Ana Rivera")
		expect(text).toContain("10/19/2026")
		for (const label of ["# Orden", "Pedido", "SMR", "Título"])
			expect(text).toContain(label)
		// One page, issued by JAF, bilingual.
		const doc = await getDocumentProxy(new Uint8Array(pdf))
		expect(doc.numPages).toBe(1)
		expect(text).toContain("Filled in by JAF / Completado por JAF")
		expect(text).toContain("For Claro / Para Claro")
	})

	it("leaves Claro's boxes empty: nothing follows a label but the next label", async () => {
		const text = await textOf(await generateClaroPrefieldPdf(input()))
		const claro = text.slice(text.indexOf("For Claro / Para Claro"))
		expect(claro.replace(/\s+/g, " ").trim()).toBe(
			"For Claro / Para Claro Order # / # Orden Order request / Pedido SMR Title / Título",
		)
	})

	it("prints a dash for a missing Dept # or Claro supervisor", async () => {
		const text = await textOf(
			await generateClaroPrefieldPdf(
				input({ deptNumber: null, claroSupervisor: null, title: null }),
			),
		)
		expect(text).toContain("Dept #")
		expect(text).not.toContain("OESTE")
		expect(text).not.toContain("Ana Rivera")
	})
})

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs"
import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import { generateFacturaDePagoPdf } from "./factura-de-pago.server"

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

/** Sample M19-3440, made from PO 4500514930, under its new number. */
const sample = {
	number: "M20-001",
	madeAt: new Date("2026-07-06T15:00:00Z"),
	workMonth: "2026-04",
	poNumber: "4500514930",
	subtotal: 1749.04,
	ivu4: 11.33,
	ivu115: 168.56,
	total: 1928.93,
	signature: PNG,
}

const textOf = async (pdf: Buffer) =>
	(await extractText(new Uint8Array(pdf), { mergePages: true })).text

describe("generateFacturaDePagoPdf", () => {
	it("fills every box from the PO and the system (boxes 1-14)", async () => {
		const text = await textOf(await generateFacturaDePagoPdf(sample))
		for (const piece of [
			"JAF Communications, Inc.",
			"PO Box 11468, Caparra Heights, PR 00922-",
			"Factura de Pago - Claro",
			"Page 1 of 1",
			"M20-001",
			"PWOR",
			"07/06/26",
			"04/01/2026",
			"04/30/2026",
			"MANT-JAF-ABR-2026",
			"Mantenimiento Planta Externa",
			"4500514930",
			"Total Pedidos",
			"$1,749.04",
			"$179.89",
			"168.56",
			"11.33",
			"$168.56",
			"$11.33",
			"1,928.93",
		])
			expect(text).toContain(piece)
	})

	it("is one page", async () => {
		const pdf = await generateFacturaDePagoPdf(sample)
		const doc = await getDocumentProxy(new Uint8Array(pdf))
		expect(doc.numPages).toBe(1)
	})

	it("stamps the signature twice: Certificado por and Firma (boxes 15, 16)", async () => {
		const pdf = await generateFacturaDePagoPdf(sample)
		const doc = await getDocumentProxy(new Uint8Array(pdf))
		const page = await doc.getPage(1)
		const ops = await page.getOperatorList()
		const images = ops.fnArray.filter(
			(f: number) =>
				f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject,
		)
		expect(images).toHaveLength(2)
	})

	it("dates Certificado por with the invoice date, the same as FECHA", async () => {
		const text = await textOf(await generateFacturaDePagoPdf(sample))
		expect(text.match(/07\/06\/26/g)).toHaveLength(2)
	})
})

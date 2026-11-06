import fs from "node:fs"
import path from "node:path"
import { getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import { REAL_POS } from "~/lib/__fixtures__/po/real-pos"
import { parseOcrPasses } from "~/lib/po-ocr-parse"
import { getPoReader, ocrPdfPasses } from "~/lib/po-reader.server"
import { type PoRead, runPoChecks } from "~/lib/po-reading"

const SAMPLE = "docs/lissette-closed-file-docs/4- po from claro.pdf"

// Reads Kay's real scanned PO with the real OCR: no network, no API.
describe.skipIf(!fs.existsSync(SAMPLE))("Tesseract PO reader", () => {
	it("reads the sample PO 4500510139 off the scan", async () => {
		const r = await getPoReader()(new Uint8Array(fs.readFileSync(SAMPLE)))
		expect(r).toMatchObject({
			poNumber: "4500510139",
			poDate: "2026-05-14",
			statedPages: 4,
			termsDays: 60,
			subtotal: 403.86,
			ivu4: 16.15,
			ivu115: 0,
			total: 420.01,
		})
		expect(r.avisoCandidates[0]).toBe("10333185")
		expect(r.lines).toHaveLength(1)
	}, 240_000)
})

const FIXTURES = path.join(import.meta.dirname, "__fixtures__/po")
const pdfOf = (po: string) =>
	new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${po}.pdf`)))
const filePages = async (pdf: Uint8Array) =>
	(await getDocumentProxy(pdf.slice())).numPages
const ctxFor = (pages: number) => ({
	filePages: pages,
	duplicate: false,
	billedPreIvu: null,
	alreadyPod: 0,
})
const expectRead = (r: PoRead, want: (typeof REAL_POS)[number]) => {
	expect(r).toMatchObject({
		poNumber: want.po,
		poDate: want.poDate,
		statedPages: 4,
		subtotal: want.subtotal,
		ivu4: want.ivu4,
		ivu115: want.ivu115,
		total: want.total,
	})
	expect(r.lines).toMatchObject(want.lines)
}

describe("reads every line and page of the real multi-page POs", () => {
	for (const want of REAL_POS)
		it(`PO ${want.po}, from its text layer`, async () => {
			const pdf = pdfOf(want.po)
			const pages = await filePages(pdf)
			expect(pages).toBe(4)
			const r = await getPoReader()(pdf)
			expectRead(r, want)
			expect(runPoChecks(r, ctxFor(pages))).toEqual([])
		})

	// A scan of the same PO has no text layer and goes to OCR.
	it("PO 4500518285, read as a scan with Tesseract", async () => {
		const want = REAL_POS[0]
		const pdf = pdfOf(want.po)
		const r = parseOcrPasses(await ocrPdfPasses(pdf))
		expectRead(r, want)
		expect(runPoChecks(r, ctxFor(await filePages(pdf)))).toEqual([])
	}, 240_000)
})

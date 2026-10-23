import fs from "node:fs"
import { describe, expect, it } from "vitest"
import { getPoReader } from "~/lib/po-reader.server"

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

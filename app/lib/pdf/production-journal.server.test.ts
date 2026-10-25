import { describe, expect, it } from "vitest"
import { buildJournalBlocks } from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"

const invoice = (
	id: string,
	control: string,
	aviso: string,
	gross: number,
) => ({
	id,
	controlNumber: control,
	avisoNumber: aviso,
	contractorAccount: { id: "a", code: "016", label: "Carlos Martínez" },
	contractorShareLines: [
		{
			claroCode: "34012039",
			name: "REMOCION BAJANTE",
			qty: 1,
			unitPrice: gross,
			gross,
			sharePercent: 0.65,
			net: 0,
			retention: 0,
			adjNet: 0,
		},
	],
})

describe("generateProductionJournalPdf", () => {
	it("renders the journal with prices (Lissette's copy)", async () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "MAINT261012032", "10354739", 118.45),
		])
		const bytes = await generateProductionJournalPdf({ label: "run" }, blocks, {
			showPrices: true,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders the brigade copy without prices", async () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "MAINT261012032", "10354739", 118.45),
		])
		const bytes = await generateProductionJournalPdf({ label: "run" }, blocks, {
			showPrices: false,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders a request with no brigades without throwing", async () => {
		const bytes = await generateProductionJournalPdf({ label: "empty" }, [], {
			showPrices: false,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("running Adj. Net is figured on the brigade's gross so far", () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "M-1", "1", 928.88),
			invoice("i2", "M-2", "2", 0.68),
		])
		// floor(92888 × 0.585) = 543.39, then floor(92956 × 0.585) = 543.79
		expect(blocks[0].jobs[0].adjNetRunning).toBe(543.39)
		expect(blocks[0].jobs[1].adjNetRunning).toBe(543.79)
	})
})

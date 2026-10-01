import { describe, expect, it } from "vitest"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"

describe("generateProductionJournalPdf", () => {
	it("generates a non-empty PDF buffer for a run with blocks", async () => {
		const bytes = await generateProductionJournalPdf(
			{ label: "Run 9/10", generatedAt: new Date("2026-09-10") },
			[
				{
					brigadeCode: "016",
					brigadeLabel: "CARLOS MARTINEZ",
					gross: 118.45,
					net: 76.99,
					retention: 7.69,
					totalSC: 69.28,
					jobs: [
						{
							invoiceId: "i1",
							controlNumber: "M-3545",
							avisoNumber: "10354739",
							lines: [
								{
									claroCode: "34012039",
									description: "REMOCION BAJANTE GPON",
									qty: 1,
									unitPrice: 23.0,
									gross: 23.0,
									net: 14.95,
									pctRet: 0,
									retention: 1.49,
									adjNet: 13.45,
								},
								{
									claroCode: "34012040",
									description: "REEMPLAZO DE BAJANTE FRONTAL",
									qty: 1,
									unitPrice: 95.45,
									gross: 95.45,
									net: 62.04,
									pctRet: 0,
									retention: 6.2,
									adjNet: 55.83,
								},
							],
							gross: 118.45,
							net: 76.99,
							retention: 7.69,
							adjNet: 69.28,
							adjNetRunning: 69.28,
						},
					],
				},
			],
		)
		expect(bytes.length).toBeGreaterThan(0)
		expect(bytes.subarray(0, 4).toString("utf-8")).toBe("%PDF")
	})

	it("generates a valid empty-run PDF without throwing", async () => {
		const bytes = await generateProductionJournalPdf(
			{ label: "Run empty", generatedAt: new Date() },
			[],
		)
		expect(bytes.length).toBeGreaterThan(0)
	})
})

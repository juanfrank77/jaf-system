import { describe, expect, it } from "vitest"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"

describe("generateProductionJournalPdf", () => {
	it("generates a non-empty PDF buffer for a run with blocks", async () => {
		const bytes = await generateProductionJournalPdf(
			{ label: "Run 9/10", generatedAt: new Date("2026-09-10") },
			[
				{
					contractorAccountId: "acc1",
					accountCode: "009",
					contractorLabel: "Jesús Martínez",
					winpayEmployeeCode: "E-0231",
					isPlaceholder: true,
					gross: 2104.4,
					net: 1367.86,
					retention: 136.79,
					adjNetRunning: 1231.07,
					rows: [
						{
							invoiceId: "i1",
							controlNumber: "JAF-1",
							avisoNumber: "A1",
							claroCode: "34006301",
						},
					],
				},
			],
		)
		expect(bytes.length).toBeGreaterThan(0)
		// PDF magic bytes
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

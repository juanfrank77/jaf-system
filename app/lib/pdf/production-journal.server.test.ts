import { describe, expect, it } from "vitest"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"

describe("generateProductionJournalPdf", () => {
	it("generates a non-empty PDF for a request with brigades", async () => {
		const bytes = await generateProductionJournalPdf(
			{ label: "10/12/2026 – 10/25/2026" },
			[
				{
					brigadeCode: "025",
					accountCode: "025",
					unverified: false,
					brigadeLabel: "ALEXIS DIAZ",
					avisoNumbers: ["30077820"],
					net: 131.52,
					retention: 13.15,
					toPay: 118.37,
				},
				{
					brigadeCode: "009",
					accountCode: "009",
					unverified: false,
					brigadeLabel: "JESUS MARTINEZ",
					avisoNumbers: ["10356113", "10356247"],
					net: 76.99,
					retention: 7.69,
					toPay: 69.3,
				},
			],
		)
		expect(bytes.length).toBeGreaterThan(500)
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders a request with no brigades without throwing", async () => {
		const bytes = await generateProductionJournalPdf({ label: "empty" }, [])
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})
})

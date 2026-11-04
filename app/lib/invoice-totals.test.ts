import { describe, expect, it } from "vitest"
import { computeInvoiceTotals, IVU_RATE_REDUCED } from "./invoice-totals"

describe("computeInvoiceTotals", () => {
	// Claro PO 4500526054: two lines at 4%, one at 11.5%.
	it("reproduces the sample PO to the cent", () => {
		const totals = computeInvoiceTotals([
			{ qty: 1, unitPrice: 207.9, ivuRate: IVU_RATE_REDUCED },
			{ qty: 1, unitPrice: 16.23, ivuRate: IVU_RATE_REDUCED },
			{ qty: 1, unitPrice: 592.76 },
		])
		expect(totals.lines.map((l) => l.lineIvu)).toEqual([8.32, 0.65, 68.17])
		expect(totals.subtotal).toBe(816.89)
		expect(totals.ivu4).toBe(8.97)
		expect(totals.ivu115).toBe(68.17)
		expect(totals.ivu).toBe(77.14)
		expect(totals.total).toBe(894.03)
	})

	it("rounds each line once, then adds up", () => {
		// 3 x 0.335 = 1.005 -> 1.01 per line; two lines -> 2.02, not round(2.01)
		const totals = computeInvoiceTotals([
			{ qty: 3, unitPrice: 0.335 },
			{ qty: 3, unitPrice: 0.335 },
		])
		expect(totals.lines.map((l) => l.lineAmount)).toEqual([1.01, 1.01])
		expect(totals.subtotal).toBe(2.02)
	})

	it("defaults to 11.5% and honours a different default", () => {
		expect(computeInvoiceTotals([{ qty: 2, unitPrice: 100 }]).ivu).toBe(23)
		expect(computeInvoiceTotals([{ qty: 2, unitPrice: 100 }], 0.1).ivu).toBe(20)
	})

	it("is zero for no lines, and ignores non-numeric quantities", () => {
		expect(computeInvoiceTotals([])).toMatchObject({
			subtotal: 0,
			ivu: 0,
			total: 0,
		})
		expect(
			computeInvoiceTotals([{ qty: Number.NaN, unitPrice: 5 }]).total,
		).toBe(0)
	})
})

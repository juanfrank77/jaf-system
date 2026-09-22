import { describe, expect, it } from "vitest"
import {
	AvisoAmountMismatchError,
	assertAvisoAmountMatches,
	avisoAmountMatch,
} from "./aviso-guard.server"

const invoiceLines = [
	{
		serviceCodeId: "c1",
		claroCode: "34006301",
		qty: 5,
		unitPrice: 42.343,
		lineAmount: 211.72,
	},
]

describe("aviso-guard", () => {
	it("passes when totals agree within tolerance", () => {
		const match = avisoAmountMatch(
			{
				jafInvoiceLines: invoiceLines,
				avisoLines: [
					{
						serviceCodeId: "c1",
						claroCode: "34006301",
						qty: 5,
						unitPrice: 42.343,
						lineAmount: 211.72,
					},
				],
			},
			0.01,
		)
		expect(match.amountOk).toBe(true)
		expect(() =>
			assertAvisoAmountMatches(
				{
					jafInvoiceLines: invoiceLines,
					avisoLines: [
						{
							serviceCodeId: "c1",
							claroCode: "34006301",
							qty: 5,
							unitPrice: 42.343,
							lineAmount: 211.72,
						},
					],
				},
				0.01,
			),
		).not.toThrow()
	})

	it("throws when totals differ beyond tolerance", () => {
		expect(() =>
			assertAvisoAmountMatches(
				{
					jafInvoiceLines: invoiceLines,
					avisoLines: [
						{
							serviceCodeId: "c1",
							claroCode: "34006301",
							qty: 5,
							unitPrice: 100,
							lineAmount: 500,
						},
					],
				},
				0.01,
			),
		).toThrow(AvisoAmountMismatchError)
	})

	it("does not trust a stale match when lines are missing", () => {
		const match = avisoAmountMatch(
			{ jafInvoiceLines: invoiceLines, avisoLines: null },
			0.01,
		)
		expect(match.amountOk).toBe(false)
	})
})

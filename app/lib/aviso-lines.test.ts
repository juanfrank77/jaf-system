import { describe, expect, it } from "vitest"
import { buildAvisoLines } from "./aviso-lines"
import type { InvoiceLine } from "./service-lines"

const invoice = [
	{ serviceCodeId: "c1", claroCode: "34012039", qty: 1, unitPrice: 10 },
] as InvoiceLine[]
const catalog = [
	{ id: "c1", claroCode: "34012039", unitPrice: "99" },
	{ id: "c2", claroCode: "34012040", unitPrice: "12.5" },
]
const row = (claroCode: string, qtyUsed: number) => ({
	claroCode,
	qtyInitial: qtyUsed,
	qtyUsed,
})

describe("buildAvisoLines", () => {
	it("prices from the invoice line when the code is on it, else the catalog", () => {
		const r = buildAvisoLines(
			[row("34012039", 2), row("34012040", 3)],
			invoice,
			catalog,
		)
		expect(r).toEqual({
			lines: [
				{
					serviceCodeId: "c1",
					claroCode: "34012039",
					qty: 2,
					unitPrice: 10,
					lineAmount: 20,
				},
				{
					serviceCodeId: "c2",
					claroCode: "34012040",
					qty: 3,
					unitPrice: 12.5,
					lineAmount: 37.5,
				},
			],
		})
	})

	it("sums duplicate codes and drops zero-quantity rows", () => {
		const r = buildAvisoLines(
			[row("34012039", 1), row("34012039", 2), row("34012040", 0)],
			invoice,
			catalog,
		)
		expect(r).toMatchObject({ lines: [{ qty: 3, lineAmount: 30 }] })
		expect("lines" in r && r.lines).toHaveLength(1)
	})

	it("lists unknown codes, unique and sorted", () => {
		const r = buildAvisoLines(
			[row("34099999", 1), row("34088888", 1), row("34099999", 2)],
			invoice,
			catalog,
		)
		expect(r).toEqual({ missingCodes: ["34088888", "34099999"] })
	})
})

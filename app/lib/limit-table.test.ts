import { describe, expect, it } from "vitest"
import { pickBracket, prefillAccessories } from "./limit-table"

const rows = [
	{ bracketFt: 250, serviceCodeId: "jota", qty: 2 },
	{ bracketFt: 500, serviceCodeId: "jota", qty: 3 },
	{ bracketFt: 500, serviceCodeId: "mordaza", qty: 10 },
]

describe("limit table", () => {
	it("rounds up to the next bracket and clamps to max", () => {
		expect(pickBracket(400, [250, 500, 750])).toBe(500)
		expect(pickBracket(250, [250, 500, 750])).toBe(250)
		expect(pickBracket(9000, [250, 500, 750])).toBe(750)
	})
	it("prefills accessory rows for the bracket", () => {
		expect(prefillAccessories(rows, 500)).toEqual([
			{ serviceCodeId: "jota", prefilledQty: 3, qty: 3 },
			{ serviceCodeId: "mordaza", prefilledQty: 10, qty: 10 },
		])
	})
})

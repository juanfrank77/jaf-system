import { describe, expect, it } from "vitest"
import { buildRestockSubmitState } from "./installer-restock"

describe("buildRestockSubmitState", () => {
	const comparison = [
		{
			serviceCodeId: "sc-1",
			claroCode: "111",
			name: "Cable",
			onHand: 2,
			standard: 5,
			delta: -3,
		},
		{
			serviceCodeId: "sc-2",
			claroCode: "222",
			name: "Tape",
			onHand: 10,
			standard: 5,
			delta: 5,
		},
	]

	it("requires warehouse and at least one positive qty", () => {
		expect(
			buildRestockSubmitState({
				warehouseId: "",
				qtyByRow: { "sc-1": "0" },
				comparison,
			}).canSubmit,
		).toBe(false)

		expect(
			buildRestockSubmitState({
				warehouseId: "wh-1",
				qtyByRow: { "sc-1": "2" },
				comparison,
			}).canSubmit,
		).toBe(true)
	})

	it("rejects invalid qty values", () => {
		expect(
			buildRestockSubmitState({
				warehouseId: "wh-1",
				qtyByRow: { "sc-1": "abc" },
				comparison,
			}).canSubmit,
		).toBe(false)
	})
})

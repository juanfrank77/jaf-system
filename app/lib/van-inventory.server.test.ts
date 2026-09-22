import { describe, expect, it } from "vitest"
import {
	buildInventoryComparison,
	buildRestockPrefillMap,
	computeRestockPrefillQty,
	computeVanInventory,
	evaluateRestockApproval,
	getOnHand,
} from "./van-inventory"

describe("van-inventory helpers", () => {
	describe("computeVanInventory", () => {
		it("sums positive and negative transactions per service code", () => {
			const inventory = computeVanInventory([
				{ serviceCodeId: "sc-1", qty: 10, type: "RESTOCK" },
				{ serviceCodeId: "sc-1", qty: -3, type: "INSTALL" },
				{ serviceCodeId: "sc-2", qty: 5, type: "RESTOCK" },
			])
			expect(inventory.get("sc-1")).toBe(7)
			expect(inventory.get("sc-2")).toBe(5)
		})
	})

	describe("getOnHand", () => {
		it("returns zero when no transactions exist", () => {
			expect(getOnHand([], "sc-1")).toBe(0)
		})

		it("returns the computed on-hand quantity", () => {
			expect(
				getOnHand([{ serviceCodeId: "sc-1", qty: 4, type: "RESTOCK" }], "sc-1"),
			).toBe(4)
		})
	})

	describe("evaluateRestockApproval", () => {
		it("does not require approval when restock stays at or below par", () => {
			const result = evaluateRestockApproval(
				[{ serviceCodeId: "sc-1", qty: 3 }],
				[{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" }],
				[{ serviceCodeId: "sc-1", qty: 5 }],
			)
			expect(result.requiresApproval).toBe(false)
			expect(result.reasons).toHaveLength(0)
		})

		it("requires approval when restock exceeds par level", () => {
			const result = evaluateRestockApproval(
				[{ serviceCodeId: "sc-1", qty: 4 }],
				[{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" }],
				[{ serviceCodeId: "sc-1", qty: 5 }],
			)
			expect(result.requiresApproval).toBe(true)
			expect(result.reasons).toContain("sc-1")
		})

		it("accounts for pending requests when evaluating approval", () => {
			const result = evaluateRestockApproval(
				[{ serviceCodeId: "sc-1", qty: 4 }],
				[
					{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
					{ serviceCodeId: "sc-1", qty: 5, type: "RESTOCK" },
				],
				[{ serviceCodeId: "sc-1", qty: 10 }],
			)
			expect(result.requiresApproval).toBe(true)
			expect(result.reasons).toContain("sc-1")
		})

		it("does not require approval when pending requests keep total at or below par", () => {
			const result = evaluateRestockApproval(
				[{ serviceCodeId: "sc-1", qty: 3 }],
				[
					{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
					{ serviceCodeId: "sc-1", qty: 3, type: "RESTOCK" },
				],
				[{ serviceCodeId: "sc-1", qty: 10 }],
			)
			expect(result.requiresApproval).toBe(false)
			expect(result.reasons).toHaveLength(0)
		})

		it("does not require approval for prefilled-to-par quantities", () => {
			const transactions = [
				{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" as const },
			]
			const standards = [{ serviceCodeId: "sc-1", qty: 5 }]
			const prefillQty = computeRestockPrefillQty(
				"sc-1",
				transactions,
				standards,
			)
			expect(prefillQty).toBe(3)
			const result = evaluateRestockApproval(
				[{ serviceCodeId: "sc-1", qty: prefillQty }],
				transactions,
				standards,
			)
			expect(result.requiresApproval).toBe(false)
		})
	})

	describe("computeRestockPrefillQty", () => {
		const standards = [{ serviceCodeId: "sc-1", qty: 10 }]

		it("prefills below-par gap", () => {
			expect(
				computeRestockPrefillQty(
					"sc-1",
					[{ serviceCodeId: "sc-1", qty: 3, type: "RESTOCK" }],
					standards,
				),
			).toBe(7)
		})

		it("returns zero at or above par", () => {
			expect(
				computeRestockPrefillQty(
					"sc-1",
					[{ serviceCodeId: "sc-1", qty: 10, type: "RESTOCK" }],
					standards,
				),
			).toBe(0)
			expect(
				computeRestockPrefillQty(
					"sc-1",
					[{ serviceCodeId: "sc-1", qty: 12, type: "RESTOCK" }],
					standards,
				),
			).toBe(0)
		})

		it("returns zero when no par level is set", () => {
			expect(
				computeRestockPrefillQty(
					"sc-1",
					[{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" }],
					[],
				),
			).toBe(0)
		})

		it("accounts for pending request qty like evaluateRestockApproval", () => {
			expect(
				computeRestockPrefillQty(
					"sc-1",
					[
						{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
						{ serviceCodeId: "sc-1", qty: 3, type: "RESTOCK" },
					],
					standards,
				),
			).toBe(5)
		})
	})

	describe("buildRestockPrefillMap", () => {
		it("includes only rows with a positive prefill", () => {
			expect(
				buildRestockPrefillMap(
					[
						{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
						{ serviceCodeId: "sc-2", qty: 5, type: "RESTOCK" },
					],
					[
						{ serviceCodeId: "sc-1", qty: 5 },
						{ serviceCodeId: "sc-2", qty: 5 },
					],
				),
			).toEqual({ "sc-1": 3 })
		})
	})

	describe("buildInventoryComparison", () => {
		it("returns on-hand vs standard for each tracked product", () => {
			const serviceCodeMap = new Map([
				["sc-1", { claroCode: "34000001", name: "Cable" }],
			])
			const result = buildInventoryComparison(
				[{ serviceCodeId: "sc-1", qty: 3, type: "RESTOCK" }],
				[{ serviceCodeId: "sc-1", qty: 5 }],
				serviceCodeMap,
			)
			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				claroCode: "34000001",
				onHand: 3,
				standard: 5,
				delta: -2,
			})
		})
	})
})

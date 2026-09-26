import { describe, expect, it } from "vitest"
import {
	deriveAccessoryStock,
	deriveSerializedStock,
	nextSerialState,
	owedBack,
} from "./van-inventory-v3"

describe("derived van inventory", () => {
	it("sums accessory movements per code", () => {
		const s = deriveAccessoryStock([
			{ serviceCodeId: "a", qty: 15 },
			{ serviceCodeId: "a", qty: -2 },
			{ serviceCodeId: "b", qty: 8 },
		])
		expect(s).toEqual({ a: 13, b: 8 })
	})
	it("counts serialized units on a van by SKU", () => {
		const s = deriveSerializedStock(
			[
				{ serviceCodeId: "m", status: "VAN", currentRef: "v1" },
				{ serviceCodeId: "m", status: "VAN", currentRef: "v1" },
				{ serviceCodeId: "m", status: "INSTALLED", currentRef: "c9" },
				{ serviceCodeId: "m", status: "VAN", currentRef: "v2" },
			],
			"v1",
		)
		expect(s).toEqual({ m: 2 })
	})
	it("lists owed-back serials for a van", () => {
		expect(
			owedBack(
				[
					{ serial: "x", status: "REMOVED_PENDING_RETURN", currentRef: "v1" },
					{ serial: "y", status: "VAN", currentRef: "v1" },
				],
				"v1",
			),
		).toEqual(["x"])
	})
	it("advances serial state authoritatively", () => {
		expect(nextSerialState("VAN", "INSTALL")).toBe("INSTALLED")
		expect(nextSerialState("INSTALLED", "SWAP_OUT")).toBe(
			"REMOVED_PENDING_RETURN",
		)
		expect(nextSerialState("REMOVED_PENDING_RETURN", "RETURN")).toBe("RETURNED")
		expect(() => nextSerialState("INSTALLED", "INSTALL")).toThrow()
	})
})

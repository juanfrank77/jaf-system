import { describe, expect, it } from "vitest"
import { shareFigures } from "./contractor-share"

describe("shareFigures", () => {
	it("truncates every figure from the gross, never Net − Retention", () => {
		// Brigade 009, gross 10,679.00: Net 6,941.35, Ret 694.13, Pay 6,247.21.
		// Net − Ret would give 6,247.22.
		expect(shareFigures(10679, 65)).toEqual({
			net: 6941.35,
			retention: 694.13,
			adjNet: 6247.21,
		})
	})

	it("pays 80% on a D line", () => {
		expect(shareFigures(1000, 80)).toEqual({
			net: 800,
			retention: 80,
			adjNet: 720,
		})
		expect(shareFigures(118.45, 80).adjNet).toBe(85.28)
	})

	it("matches the client's worked example ($118.45 gross -> $69.29)", () => {
		expect(shareFigures(118.45, 65).adjNet).toBe(69.29)
	})

	it("does not lose a cent to float error", () => {
		expect(shareFigures(0.29, 100).net).toBe(0.29)
		expect(shareFigures(4.35, 100).net).toBe(4.35)
	})
})

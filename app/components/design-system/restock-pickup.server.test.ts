import { describe, expect, it } from "vitest"
import { canConfirmPickup } from "./restock-pickup"

describe("canConfirmPickup", () => {
	it("requires both signatures and an unsubmitted form", () => {
		expect(
			canConfirmPickup({
				warehouseSigned: false,
				installerSigned: false,
				submitted: false,
			}),
		).toBe(false)
		expect(
			canConfirmPickup({
				warehouseSigned: true,
				installerSigned: false,
				submitted: false,
			}),
		).toBe(false)
		expect(
			canConfirmPickup({
				warehouseSigned: true,
				installerSigned: true,
				submitted: false,
			}),
		).toBe(true)
		expect(
			canConfirmPickup({
				warehouseSigned: true,
				installerSigned: true,
				submitted: true,
			}),
		).toBe(false)
	})
})

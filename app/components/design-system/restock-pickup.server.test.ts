import { describe, expect, it } from "vitest"
import { canConfirmPickup } from "./restock-pickup"

describe("canConfirmPickup", () => {
	it("requires the installer signature and an unsubmitted form", () => {
		expect(
			canConfirmPickup({
				installerSigned: false,
				submitted: false,
			}),
		).toBe(false)
		expect(
			canConfirmPickup({
				installerSigned: true,
				submitted: false,
			}),
		).toBe(true)
		expect(
			canConfirmPickup({
				installerSigned: true,
				submitted: true,
			}),
		).toBe(false)
	})
})

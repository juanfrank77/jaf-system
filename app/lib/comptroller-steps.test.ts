import { describe, expect, it } from "vitest"
import { nextComptrollerStep } from "./comptroller-steps"

describe("nextComptrollerStep", () => {
	const none = { advanceReceived: false, crewPaid: false, finalReceived: false }

	it("starts at the PBCC advance", () => {
		expect(nextComptrollerStep(none)).toBe("ADVANCE")
	})

	it("moves to the crew payment once the advance is in", () => {
		expect(nextComptrollerStep({ ...none, advanceReceived: true })).toBe("CREW")
	})

	it("moves to Claro's final payment once the crew is paid", () => {
		expect(
			nextComptrollerStep({ ...none, advanceReceived: true, crewPaid: true }),
		).toBe("FINAL")
	})

	it("returns null once all three are recorded", () => {
		expect(
			nextComptrollerStep({
				advanceReceived: true,
				crewPaid: true,
				finalReceived: true,
			}),
		).toBeNull()
	})
})

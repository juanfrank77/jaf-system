import { describe, expect, it } from "vitest"
import { canViewJobStep, isJobStepMine, JOB_STEPS } from "./job-steps"

describe("job steps by role", () => {
	it("gives CREW no step to own or open (crew accounts no longer sign in)", () => {
		for (const step of JOB_STEPS) {
			expect(isJobStepMine("CREW", step)).toBe(false)
			expect(canViewJobStep("CREW", step)).toBe(false)
		}
	})

	it("keeps the warehouse on Release (the dual-signature screen) and the supervisor on Field", () => {
		expect(isJobStepMine("WAREHOUSE", "RELEASE")).toBe(true)
		expect(canViewJobStep("WAREHOUSE", "RELEASE")).toBe(true)
		expect(canViewJobStep("ADMIN", "RELEASE")).toBe(true)
		expect(isJobStepMine("SUPERVISOR", "FIELD")).toBe(true)
	})
})

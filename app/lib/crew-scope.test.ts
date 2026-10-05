import { describe, expect, it } from "vitest"
import { isUnassignedCrew } from "./crew-scope"

describe("isUnassignedCrew", () => {
	const doc = { assignedCrewIds: ["crew-1", "crew-2"] }

	it("is false for a crew member assigned to the job", () => {
		expect(isUnassignedCrew({ id: "crew-1", role: "CREW" }, doc)).toBe(false)
	})

	it("is true for a crew member not assigned to the job", () => {
		expect(isUnassignedCrew({ id: "crew-9", role: "CREW" }, doc)).toBe(true)
	})

	it("is true for a crew member when nobody is assigned", () => {
		expect(
			isUnassignedCrew({ id: "crew-1", role: "CREW" }, { assignedCrewIds: [] }),
		).toBe(true)
	})

	it.each(["SUPERVISOR", "WAREHOUSE", "FINANCE", "ADMIN", "INSTALLER"])(
		"never restricts %s",
		(role) => {
			expect(isUnassignedCrew({ id: "x", role }, doc)).toBe(false)
		},
	)
})

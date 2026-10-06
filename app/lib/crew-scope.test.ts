import { describe, expect, it } from "vitest"
import {
	isNotAssignedError,
	isUnassignedCrew,
	notAssignedResponse,
} from "./crew-scope"

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

describe("notAssignedResponse", () => {
	it("is a 404 whose body marks it as not-assigned, with no job data", async () => {
		const res = notAssignedResponse()
		expect(res.status).toBe(404)
		expect(await res.text()).toBe("NOT_ASSIGNED")
	})

	it("is recognised by isNotAssignedError once react-router wraps it", () => {
		expect(isNotAssignedError({ status: 404, data: "NOT_ASSIGNED" })).toBe(true)
	})

	it.each([
		{ status: 404, data: "Not Found" },
		{ status: 403, data: "NOT_ASSIGNED" },
		new Error("NOT_ASSIGNED"),
		null,
		undefined,
	])("does not mistake %o for a not-assigned error", (err) => {
		expect(isNotAssignedError(err)).toBe(false)
	})
})

import { describe, expect, it } from "vitest"
import { nextActionHref } from "./doc-next-action"

const doc = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "doc-1",
	status,
	assignedCrewIds: ["crew-1"],
	releasedToFinanceAt: null,
	...extra,
})

describe("nextActionHref", () => {
	it("sends a SUPERVISOR to Field while the job is picked up (SIGNED)", () => {
		expect(nextActionHref(doc("SIGNED"), "SUPERVISOR", "sup-1")).toBe(
			"/docs/doc-1/field",
		)
	})

	it("sends ADMIN to Field at SIGNED too", () => {
		expect(nextActionHref(doc("SIGNED"), "ADMIN", "admin-1")).toBe(
			"/docs/doc-1/field",
		)
	})

	it("no longer sends crew to Field (they never log in; the route refuses them)", () => {
		expect(nextActionHref(doc("SIGNED"), "CREW", "crew-1")).toBeNull()
	})

	it("keeps the other steps", () => {
		expect(nextActionHref(doc("CREATED"), "WAREHOUSE", "w")).toBe(
			"/docs/doc-1/prep",
		)
		expect(nextActionHref(doc("PREPPED"), "WAREHOUSE", "w")).toBe(
			"/docs/doc-1/sign",
		)
		expect(nextActionHref(doc("FIELD_UPDATED"), "SUPERVISOR", "s")).toBe(
			"/docs/doc-1/review",
		)
		expect(nextActionHref(doc("SUPERVISOR_APPROVED"), "SUPERVISOR", "s")).toBe(
			"/docs/doc-1/review",
		)
		expect(nextActionHref(doc("SUPERVISOR_APPROVED"), "FINANCE", "f")).toBe(
			"/finance/verify/doc-1",
		)
		expect(nextActionHref(doc("SIGNED"), "FINANCE", "f")).toBeNull()
	})
})

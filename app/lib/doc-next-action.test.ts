import { describe, expect, it } from "vitest"
import { nextActionHref } from "./doc-next-action"

const doc = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "doc-1",
	status,
	releasedToFinanceAt: null,
	...extra,
})

describe("nextActionHref", () => {
	it("sends a SUPERVISOR to Field while the job is picked up (SIGNED)", () => {
		expect(nextActionHref(doc("SIGNED"), "SUPERVISOR")).toBe(
			"/docs/doc-1/field",
		)
	})

	it("sends ADMIN to Field at SIGNED too", () => {
		expect(nextActionHref(doc("SIGNED"), "ADMIN")).toBe("/docs/doc-1/field")
	})

	it("never sends crew anywhere (crew accounts no longer sign in)", () => {
		for (const status of ["PREPPED", "SIGNED", "FIELD_UPDATED"])
			expect(nextActionHref(doc(status), "CREW")).toBeNull()
	})

	it("keeps the other steps", () => {
		expect(nextActionHref(doc("CREATED"), "WAREHOUSE")).toBe("/docs/doc-1/prep")
		expect(nextActionHref(doc("PREPPED"), "WAREHOUSE")).toBe("/docs/doc-1/sign")
		expect(nextActionHref(doc("FIELD_UPDATED"), "SUPERVISOR")).toBe(
			"/docs/doc-1/review",
		)
		expect(nextActionHref(doc("SUPERVISOR_APPROVED"), "SUPERVISOR")).toBe(
			"/docs/doc-1/review",
		)
		expect(nextActionHref(doc("SUPERVISOR_APPROVED"), "FINANCE")).toBe(
			"/finance/verify/doc-1",
		)
		expect(nextActionHref(doc("SIGNED"), "FINANCE")).toBeNull()
	})
})

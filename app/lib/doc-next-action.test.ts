import { describe, expect, it } from "vitest"
import { nextActionHref } from "./doc-next-action"

const doc = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "doc-1",
	status,
	releasedToFinanceAt: null,
	financeVerifiedAt: null,
	pbccRequestSentAt: null,
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
		expect(
			nextActionHref(
				doc("SUPERVISOR_APPROVED", { releasedToFinanceAt: new Date() }),
				"FINANCE",
			),
		).toBe("/finance/verify/doc-1")
		expect(nextActionHref(doc("SIGNED"), "FINANCE")).toBeNull()
	})

	it("sends the supervisor back to review for a packet Finance returned, not once she verified it", () => {
		const returned = {
			...doc("SUPERVISOR_APPROVED"),
			releasedToFinanceAt: new Date(),
			financeSendBackNotes: [{ note: "Fix", byUserId: "f", createdAt: "x" }],
		}
		expect(nextActionHref(returned, "SUPERVISOR")).toBe("/docs/doc-1/review")
		// A master-era return (no resentAt) on a job Finance verified is over.
		expect(
			nextActionHref(
				{ ...returned, financeVerifiedAt: new Date() },
				"SUPERVISOR",
			),
		).toBeNull()
		expect(
			nextActionHref(
				{
					...returned,
					financeSendBackNotes: [
						{ note: "Fix", byUserId: "f", createdAt: "x", resentAt: "y" },
					],
				},
				"SUPERVISOR",
			),
		).toBeNull()
	})
})

describe("nextActionHref: Finance and unreleased jobs (S4)", () => {
	const base = {
		id: "d1",
		status: "CLARO_UPLOADED",
		releasedToFinanceAt: null,
		financeVerifiedAt: null,
		pbccRequestSentAt: null,
		financeSendBackNotes: null,
	} as never
	it("does not point Finance at verify for a job the supervisor has not released", () => {
		expect(nextActionHref(base, "FINANCE")).toBeNull()
	})
	it("points Finance at verify for a released one", () => {
		expect(
			nextActionHref(
				{ ...(base as object), releasedToFinanceAt: new Date() } as never,
				"FINANCE",
			),
		).toBe("/finance/verify/d1")
	})
})

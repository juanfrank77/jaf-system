import { afterAll, describe, expect, it, vi } from "vitest"
import {
	CONTRACTOR_SHARE_PERCENT,
	computeContractorPayment,
	resolveContractorAccount,
	resolveContractorAccounts,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { makeTracker, seedContractorAccount } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("computeContractorPayment", () => {
	it("computes gross/net/retention at the 0.65 share", () => {
		const result = computeContractorPayment([
			{
				serviceCodeId: "sc1",
				claroCode: "34006301",
				name: "TRANSFER ATTCH",
				qty: 5,
				jafPrice: 42.343,
			},
		])
		// 5 × 42.343 = 211.715 gross; truncated to 211.71
		expect(result.grossPayable).toBeCloseTo(211.71, 2)
		// Net = truncate(211.715 × 0.65, 2) = truncate(137.61475, 2) = 137.61
		expect(result.contractorShareLines[0].net).toBeCloseTo(137.61, 2)
		// Retention = 10% of NET (not gross): truncate(137.61475 × 0.10, 2) = truncate(13.761475, 2) = 13.76
		expect(result.retentionAmount).toBeCloseTo(13.76, 2)
		// netPayable = truncate(211.715 × 0.65 × 0.90, 2) = truncate(123.853275, 2) = 123.85
		expect(result.netPayable).toBeCloseTo(123.85, 2)
		// sharePercent is snapshotted on every line for the generated report
		expect(result.contractorShareLines[0].sharePercent).toBe(
			CONTRACTOR_SHARE_PERCENT,
		)
	})

	it("returns all zeros for an empty line list, never throws", () => {
		const result = computeContractorPayment([])
		expect(result.contractorShareLines).toEqual([])
		expect(result.grossPayable).toBe(0)
		expect(result.retentionAmount).toBe(0)
		expect(result.netPayable).toBe(0)
	})
})

describe("resolveContractorAccount", () => {
	it("resolves an existing active account by code", async () => {
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "T-009" }),
		)
		const resolved = await resolveContractorAccount("T-009")
		expect(resolved?.id).toBe(account.id)
	})

	it("returns null for an inactive account", async () => {
		t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "T-INACTIVE", active: false }),
		)
		const resolved = await resolveContractorAccount("T-INACTIVE")
		expect(resolved).toBeNull()
	})

	it("returns null for an unmapped code", async () => {
		const resolved = await resolveContractorAccount("NOT-A-REAL-CODE")
		expect(resolved).toBeNull()
	})

	it("returns null for a null/undefined code", async () => {
		expect(await resolveContractorAccount(null)).toBeNull()
		expect(await resolveContractorAccount(undefined)).toBeNull()
	})
})

describe("resolveContractorAccounts", () => {
	it("resolves every distinct active code and keys the result by code", async () => {
		const a = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "B-001" }),
		)
		const b = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "B-002" }),
		)
		// Inactive account — should NOT appear in the map.
		t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "B-INACT", active: false }),
		)

		// Duplicates, an inactive code, and a code that resolves to nothing, in one batch.
		const resolved = await resolveContractorAccounts([
			"B-001",
			"B-002",
			"B-001",
			"B-INACT",
			"NOT-A-REAL-CODE",
			null,
		])

		expect(resolved.get("B-001")?.id).toBe(a.id)
		expect(resolved.get("B-002")?.id).toBe(b.id)
		expect(resolved.has("B-INACT")).toBe(false)
		expect(resolved.has("NOT-A-REAL-CODE")).toBe(false)
		expect(resolved.size).toBe(2)
	})

	it("queries once, not once per code (Review Focus)", async () => {
		t.track("contractorAccount", await seedContractorAccount({ code: "B-003" }))
		const findMany = vi.spyOn(db.contractorAccount, "findMany")
		const findUnique = vi.spyOn(db.contractorAccount, "findUnique")
		try {
			await resolveContractorAccounts([
				"B-003",
				"MISSING-1",
				"MISSING-2",
				"MISSING-3",
				"MISSING-4",
			])
			expect(findMany).toHaveBeenCalledTimes(1)
			expect(findUnique).not.toHaveBeenCalled()
		} finally {
			findMany.mockRestore()
			findUnique.mockRestore()
		}
	})

	it("issues no query at all when there is nothing to resolve", async () => {
		const findMany = vi.spyOn(db.contractorAccount, "findMany")
		try {
			expect((await resolveContractorAccounts([])).size).toBe(0)
			expect((await resolveContractorAccounts([null, undefined])).size).toBe(0)
			expect(findMany).not.toHaveBeenCalled()
		} finally {
			findMany.mockRestore()
		}
	})
})

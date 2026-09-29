import { afterAll, describe, expect, it } from "vitest"
import {
	computeContractorPayment,
	resolveContractorAccount,
} from "~/lib/contractor-payment.server"
import { makeTracker, seedContractorAccount } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("computeContractorPayment", () => {
	it("computes gross/net/retention at the default 0.65 share", () => {
		const result = computeContractorPayment(
			[
				{
					serviceCodeId: "sc1",
					claroCode: "34006301",
					name: "TRANSFER ATTCH",
					qty: 5,
					jafPrice: 42.343,
				},
			],
			0.65,
		)
		expect(result.grossPayable).toBeCloseTo(211.72, 2)
		// 5 × 42.343 = 211.715 gross; × 0.65 = 137.61475 net.
		expect(result.contractorShareLines[0].net).toBeCloseTo(137.61, 2)
		expect(result.retentionAmount).toBeCloseTo(21.17, 2) // 10% of gross
		expect(result.netPayable).toBeCloseTo(
			result.grossPayable * 0.65 - result.retentionAmount,
			2,
		)
	})

	it("computes at an overridden 0.80 share (equipment sub-accounts)", () => {
		const result = computeContractorPayment(
			[
				{
					serviceCodeId: "sc1",
					claroCode: "X",
					name: "X",
					qty: 1,
					jafPrice: 500,
				},
			],
			0.8,
		)
		expect(result.contractorShareLines[0].net).toBeCloseTo(400, 2)
		expect(result.retentionAmount).toBeCloseTo(50, 2) // 10% of 500 gross
		expect(result.netPayable).toBeCloseTo(400 - 50, 2)
	})

	it("returns all zeros for an empty line list, never throws", () => {
		const result = computeContractorPayment([], 0.65)
		expect(result.contractorShareLines).toEqual([])
		expect(result.grossPayable).toBe(0)
		expect(result.retentionAmount).toBe(0)
		expect(result.netPayable).toBe(0)
	})
})

describe("resolveContractorAccount", () => {
	it("resolves an existing account by code", async () => {
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "T-009", sharePercent: 0.8 }),
		)
		const resolved = await resolveContractorAccount("T-009")
		expect(resolved?.id).toBe(account.id)
		expect(resolved?.sharePercent).toBeCloseTo(0.8, 5)
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

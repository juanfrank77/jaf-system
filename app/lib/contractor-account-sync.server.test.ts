import { afterAll, describe, expect, it } from "vitest"
import { syncContractorAccount } from "~/lib/contractor-account-sync"
import { db } from "~/lib/db.server"
import { makeTracker, seedBrigade } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

const accountsOf = (brigadeId: string) =>
	db.contractorAccount.findMany({
		where: { brigadeId },
		orderBy: { code: "asc" },
	})

describe("syncContractorAccount", () => {
	it("creates the account for a brigade that has a code", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		expect(await syncContractorAccount(db, brigade)).toBe(true)
		const [account] = await accountsOf(brigade.id)
		t.track("contractorAccount", account)
		expect(account.code).toBe(brigade.code)
		expect(account.label).toBe(brigade.name)
		expect(account.active).toBe(true)
	})

	it("does nothing for a brigade with no code yet", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		const uncoded = { ...brigade, code: null }
		expect(await syncContractorAccount(db, uncoded)).toBe(false)
		expect(await accountsOf(brigade.id)).toEqual([])
	})

	it("is idempotent and follows active/name changes", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		await syncContractorAccount(db, brigade)
		await syncContractorAccount(db, {
			...brigade,
			active: false,
			name: "Renamed",
		})
		const accounts = await accountsOf(brigade.id)
		for (const a of accounts) t.track("contractorAccount", a)
		expect(accounts).toHaveLength(1)
		expect(accounts[0].active).toBe(false)
		expect(accounts[0].label).toBe("Renamed")
	})

	it("keeps the account under the previous code when the number changes", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		await syncContractorAccount(db, brigade)
		await syncContractorAccount(db, { ...brigade, code: `${brigade.code}-NEW` })
		const accounts = await accountsOf(brigade.id)
		for (const a of accounts) t.track("contractorAccount", a)
		// Jobs already signed under the old code must still resolve.
		expect(accounts.map((a) => a.code).sort()).toEqual(
			[brigade.code, `${brigade.code}-NEW`].sort(),
		)
	})
})

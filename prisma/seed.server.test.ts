import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedBrigade } from "~/test/helpers"
import { seedContractorAccounts } from "./seed-contractor-accounts"

const t = makeTracker()
afterAll(() => t.cleanup())

// `seedContractorAccounts` upserts an account for EVERY active brigade, and the
// server tests share one Neon dev database that vitest runs in parallel. Other
// test files create and delete brigades of their own, so this test asserts only
// about brigades it created — otherwise it races their fixtures and its
// upserted rows FK-block their brigade deletes.
async function seedOwnBrigades(count: number) {
	const brigades = []
	for (let i = 0; i < count; i++) {
		brigades.push(t.track("brigade", await seedBrigade()))
	}
	return brigades
}

async function accountFor(brigadeId: string, code: string) {
	return db.contractorAccount.findFirst({
		where: { brigadeId, code },
		select: { id: true, active: true, brigadeId: true, code: true },
	})
}

describe("seedContractorAccounts", () => {
	it("creates one ContractorAccount per active Brigade with a matching code", async () => {
		const brigades = await seedOwnBrigades(2)
		await seedContractorAccounts(db)

		for (const brigade of brigades) {
			const account = await accountFor(brigade.id, brigade.code as string)
			expect(account).not.toBeNull()
			expect(account?.active).toBe(true)
			expect(account?.brigadeId).toBe(brigade.id)
			// Track it so cleanup removes the row before the brigade.
			if (account) t.track("contractorAccount", account)
		}
	})

	it("is idempotent — running twice does not duplicate or error", async () => {
		const [brigade] = await seedOwnBrigades(1)
		await seedContractorAccounts(db)
		const first = await db.contractorAccount.count({
			where: { brigadeId: brigade.id },
		})
		await seedContractorAccounts(db)
		const second = await db.contractorAccount.count({
			where: { brigadeId: brigade.id },
		})
		expect(second).toBe(first)
		expect(first).toBe(1)

		for (const a of await db.contractorAccount.findMany({
			where: { brigadeId: brigade.id },
			select: { id: true },
		})) {
			t.track("contractorAccount", a)
		}
	})

	it("deactivates the account when the brigade is deactivated", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		await seedContractorAccounts(db)

		const account = await accountFor(brigade.id, brigade.code as string)
		expect(account).not.toBeNull()
		expect(account?.active).toBe(true)
		if (account) t.track("contractorAccount", account)

		await db.brigade.update({
			where: { id: brigade.id },
			data: { active: false },
		})
		await seedContractorAccounts(db)

		const after = await accountFor(brigade.id, brigade.code as string)
		expect(after?.active).toBe(false)
	})
})

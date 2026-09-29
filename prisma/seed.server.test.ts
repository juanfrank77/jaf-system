import { describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { seedContractorAccounts } from "./seed-contractor-accounts"

describe("seedContractorAccounts", () => {
	it("creates one ContractorAccount per active Brigade with a matching code", async () => {
		await seedContractorAccounts(db)
		const brigades = await db.brigade.findMany({ where: { active: true } })
		for (const brigade of brigades) {
			if (!brigade.code) continue
			const account = await db.contractorAccount.findUnique({
				where: { code: brigade.code },
			})
			expect(account).not.toBeNull()
			expect(account?.sharePercent.toString()).toBe("0.65")
			expect(account?.brigadeId).toBe(brigade.id)
		}
	})

	it("is idempotent — running twice does not duplicate or error", async () => {
		await seedContractorAccounts(db)
		await seedContractorAccounts(db)
	})
})

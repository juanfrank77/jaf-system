import { afterAll, describe, expect, it } from "vitest"
import { loadComptrollerRuns } from "~/lib/comptroller-runs.server"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

async function seedRun(
	comptrollerId: string,
	accounts: number,
): Promise<{ id: string }> {
	let run: { id: string } | null = null
	for (let i = 0; i < accounts; i++) {
		const account = t.track("contractorAccount", await seedContractorAccount())
		if (!run) {
			const seeded = await seedSweptInvoice({
				generatedById: comptrollerId,
				contractorAccountId: account.id,
				grossPayable: 1000,
				netPayable: 585,
			})
			run = t.track("payrollRun", seeded.run)
			t.track("jafInvoice", seeded.invoice)
		} else {
			const extra = await seedSweptInvoice({
				generatedById: comptrollerId,
				contractorAccountId: account.id,
				grossPayable: 500,
				netPayable: 292.5,
			})
			// Fold the extra brigade into the first run.
			await db.jafInvoice.update({
				where: { id: extra.invoice.id },
				data: { payrollRunId: run.id },
			})
			await db.payrollRun.delete({ where: { id: extra.run.id } })
			t.track("jafInvoice", extra.invoice)
		}
		if (!run) throw new Error("no run")
		await db.payrollRunAccount.create({
			data: { payrollRunId: run.id, contractorAccountId: account.id },
		})
	}
	if (!run) throw new Error("no run")
	return run
}

describe("loadComptrollerRuns", () => {
	it("lists an open run (0/2 brigades paid) in toPay and a paid run only in paid", async () => {
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const open = await seedRun(carmen.id, 2)
		const paid = await seedRun(carmen.id, 1)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: paid.id },
			data: { paidAt: new Date(), paidById: carmen.id },
		})
		await db.payrollRun.update({
			where: { id: paid.id },
			data: { paidAt: new Date(), paidById: carmen.id },
		})

		const { toPay, paid: paidRuns } = await loadComptrollerRuns()

		const openRow = toPay.find((r) => r.id === open.id)
		expect(openRow).toBeDefined()
		expect(openRow?.accounts.filter((a) => a.paidAt)).toHaveLength(0)
		expect(openRow?.accounts).toHaveLength(2)
		expect(paidRuns.some((r) => r.id === open.id)).toBe(false)
		expect(paidRuns.find((r) => r.id === paid.id)).toBeDefined()
		expect(toPay.some((r) => r.id === paid.id)).toBe(false)
	})
})

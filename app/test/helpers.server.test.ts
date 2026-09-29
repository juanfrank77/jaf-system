import { afterAll, describe, expect, it } from "vitest"
import {
	makeTracker,
	seedBrigade,
	seedContractorAccount,
	seedFinanceableInvoice,
} from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("finance test fixtures", () => {
	it("seedBrigade creates an active brigade with a code", async () => {
		const b = t.track("brigade", await seedBrigade())
		expect(b.active).toBe(true)
		expect(b.code).toBeTruthy()
	})

	it("seedContractorAccount links to a brigade by default", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ brigadeId: brigade.id }),
		)
		expect(account.brigadeId).toBe(brigade.id)
		expect(account.sharePercent.toString()).toBe("0.65")
	})

	it("seedFinanceableInvoice creates a released, unclosed, financeable job", async () => {
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountId: account.id }),
		)
		expect(doc.status).toBe("SUPERVISOR_APPROVED")
		expect(doc.releasedToFinanceAt).not.toBeNull()
		expect(doc.payablesClosedAt).toBeNull()
	})
})

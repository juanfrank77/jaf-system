import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedBrigade,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("finance test fixtures", () => {
	it("seedBrigade creates an active brigade with a code", async () => {
		const b = t.track("brigade", await seedBrigade())
		expect(b.active).toBe(true)
		expect(b.code).toBeTruthy()
	})

	it("cleanup clears BrigadeEvent rows before their brigade and user", async () => {
		const own = makeTracker()
		const user = own.track("user", await seedUser({ role: "SUPERVISOR" }))
		const brigade = own.track("brigade", await seedBrigade({ active: false }))
		// Untracked on purpose: activation writes events the test never sees.
		const event = await db.brigadeEvent.create({
			data: {
				brigadeId: brigade.id,
				userId: user.id,
				action: "BRIGADE_ACTIVATED",
				diffJson: {},
			},
		})
		await own.cleanup()
		expect(await db.brigadeEvent.count({ where: { id: event.id } })).toBe(0)
		expect(await db.brigade.count({ where: { id: brigade.id } })).toBe(0)
		expect(await db.user.count({ where: { id: user.id } })).toBe(0)
	})

	it("seedContractorAccount links to a brigade by default", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ brigadeId: brigade.id }),
		)
		expect(account.brigadeId).toBe(brigade.id)
		expect(account.active).toBe(true)
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

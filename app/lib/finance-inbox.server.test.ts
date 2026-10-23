import { afterAll, describe, expect, it } from "vitest"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"
import { inboxNeighbors } from "./finance-inbox.server"

// Integration test against the shadow DB: the three packets are released
// before any other row, so they head the Inbox in a known order.
const t = makeTracker()
afterAll(() => t.cleanup())

describe("inboxNeighbors", () => {
	it("orders by release date and wraps Next to the oldest other packet", async () => {
		const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const seed = async (year: string) =>
			t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					supervisorId: sup.id,
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date(`${year}-01-01`),
				}),
			).id
		// a, b, c are the oldest in the Inbox; d is the newest.
		const [a, b, c, d] = [
			await seed("1980"),
			await seed("1981"),
			await seed("1982"),
			await seed("2200"),
		]

		expect(await inboxNeighbors(a)).toMatchObject({ prevId: null, nextId: b })
		expect(await inboxNeighbors(b)).toMatchObject({ prevId: a, nextId: c })
		const last = await inboxNeighbors(d)
		expect(last.position).toBe(last.total)
		// Past the end it wraps to the oldest other packet instead of dead-ending.
		expect(last.nextId).toBe(a)
	})

	it("reports position 0 for a packet that is not in the Inbox", async () => {
		const out = await inboxNeighbors("not-a-real-id")
		expect(out.position).toBe(0)
		expect(out.prevId).toBeNull()
	})
})

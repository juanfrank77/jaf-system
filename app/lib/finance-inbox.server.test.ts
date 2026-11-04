import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
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

		// A resent packet (S4) heads the Inbox, so another test file's resend
		// can sit before a: only a's place relative to b and c is fixed.
		expect(await inboxNeighbors(a)).toMatchObject({ nextId: b })
		expect(await inboxNeighbors(b)).toMatchObject({ prevId: a, nextId: c })
		const last = await inboxNeighbors(d)
		expect(last.position).toBe(last.total)
		// Past the end it wraps to the first other packet instead of dead-ending.
		expect(last.nextId).toBe((await inboxNeighbors("not-a-real-id")).nextId)
	})

	it("leaves a returned packet out and puts a resent one first (S4)", async () => {
		const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const seed = async (notes: unknown) => {
			const { id } = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					supervisorId: sup.id,
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date("1990-01-01"),
				}),
			)
			await db.jafInvoice.update({
				where: { id },
				data: { financeSendBackNotes: notes as never },
			})
			return id
		}
		const entry = { note: "Fix", byUserId: sup.id, createdAt: "2026-10-01" }
		const returned = await seed([entry])
		// Resent "in 2200": newer than any resend another test file makes.
		const resent = await seed([{ ...entry, resentAt: "2200-01-01T00:00:00Z" }])
		expect((await inboxNeighbors(returned)).position).toBe(0)
		expect(await inboxNeighbors(resent)).toMatchObject({
			position: 1,
			prevId: null,
		})
	})

	it("reports position 0 for a packet that is not in the Inbox", async () => {
		const out = await inboxNeighbors("not-a-real-id")
		expect(out.position).toBe(0)
		expect(out.prevId).toBeNull()
	})
})

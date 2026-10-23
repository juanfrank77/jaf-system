import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"
import { NEXT_UP_LIMIT, PBCC_BATCH_CAPACITY } from "./finance-home"
import { loadFinanceHome } from "./finance-home.server"

// Integration test against the shadow Postgres DB. The shadow DB may hold
// other rows, so every count is asserted as a delta from a "before" read.

const { track, cleanup } = makeTracker()
const DAY = 86_400_000

const line = (qty: number, unitPrice: number) => ({
	serviceCodeId: "sc",
	claroCode: "600X",
	name: "Remoción",
	unit: "EA",
	qty,
	unitPrice,
	lineAmount: qty * unitPrice,
})

const tile = (home: Awaited<ReturnType<typeof loadFinanceHome>>, key: string) =>
	[...home.armA, ...home.armB].find((t) => t.key === key)

describe("loadFinanceHome (integration)", () => {
	let before: Awaited<ReturnType<typeof loadFinanceHome>>
	let after: Awaited<ReturnType<typeof loadFinanceHome>>

	beforeAll(async () => {
		before = await loadFinanceHome()
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const now = Date.now()
		// Two packets nobody has accepted, one 400 days old so it is the oldest.
		for (const age of [400, 1]) {
			track(
				"jafInvoice",
				await seedFinanceableInvoice({
					status: "CLARO_UPLOADED",
					supervisorId: supervisor.id,
					releasedToFinanceAt: new Date(now - age * DAY),
					pbccRequestSentAt: null,
				}),
			)
		}
		// One accepted packet waiting for the PBCC batch: 2 x $100 + 11.5% IVU.
		const accepted = track(
			"jafInvoice",
			await seedFinanceableInvoice({
				status: "CLARO_UPLOADED",
				supervisorId: supervisor.id,
				jafInvoiceLines: [line(2, 100)],
				pbccRequestSentAt: null,
			}),
		)
		await db.jafInvoice.update({
			where: { id: accepted.id },
			data: { financeVerifiedAt: new Date() },
		})
		after = await loadFinanceHome()
	})
	afterAll(cleanup)

	it("counts packets in the Inbox and finds the oldest", () => {
		expect(tile(after, "inbox")?.count).toBe(
			(tile(before, "inbox")?.count ?? 0) + 2,
		)
		expect(tile(after, "inbox")?.oldestDays).toBeGreaterThanOrEqual(400)
		expect(tile(after, "inbox")?.href).toBe("/finance/queue")
	})

	it("counts accepted packets in the PBCC batch with their IVU-inclusive total", () => {
		expect(tile(after, "pbcc_batch")?.count).toBe(
			(tile(before, "pbcc_batch")?.count ?? 0) + 1,
		)
		const gained =
			(tile(after, "pbcc_batch")?.amount ?? 0) -
			(tile(before, "pbcc_batch")?.amount ?? 0)
		expect(gained).toBeCloseTo(223, 2)
		expect(PBCC_BATCH_CAPACITY).toBe(100)
	})

	it("marks the Arm B boxes as not live", () => {
		for (const key of [
			"pos_to_confirm",
			"invoices_to_load",
			"claro_past_due",
		]) {
			expect(tile(after, key)).toMatchObject({ count: null, href: null })
		}
	})

	it("lists the oldest waiting items first, at most five, each opening its screen", () => {
		expect(after.nextUp.length).toBeLessThanOrEqual(NEXT_UP_LIMIT)
		const days = after.nextUp.map((i) => i.waitingDays)
		expect(days).toEqual([...days].sort((a, b) => b - a))
		for (const item of after.nextUp) {
			expect(item.href).toEqual(
				item.step === "PACKETS"
					? `/finance/verify/${item.id}`
					: expect.stringMatching(/^\/finance\//),
			)
		}
	})
})

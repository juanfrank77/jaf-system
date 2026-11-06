import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"
import { NEXT_UP_LIMIT, PBCC_BATCH_CAPACITY } from "./finance-home"
import { loadFinanceHome } from "./finance-home.server"
import { addToOpenBatch } from "./pbcc-batch.server"

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
	const mine: string[] = []
	let supervisorId = ""
	let before: Awaited<ReturnType<typeof loadFinanceHome>>
	let after: Awaited<ReturnType<typeof loadFinanceHome>>

	beforeAll(async () => {
		before = await loadFinanceHome()
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		supervisorId = supervisor.id
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
		// Accept puts it in the open PBCC batch.
		mine.push(accepted.id)
		await addToOpenBatch({ docId: accepted.id, userId: supervisor.id })
		after = await loadFinanceHome()
	})
	afterAll(async () => {
		// Batches this file opened hold the user that is deleted next.
		await db.jafInvoice.updateMany({
			where: { id: { in: mine } },
			data: { bankScheduleId: null },
		})
		await db.bankSchedule.deleteMany({ where: { generatedById: supervisorId } })
		await cleanup()
	})

	it("lists a payroll draft nobody sent in Next up, with its age", async () => {
		const draft = track(
			"payrollRun",
			await db.payrollRun.create({
				data: {
					label: "PR9999 · draft",
					generatedById: supervisorId,
					generatedAt: new Date(Date.now() - 9 * DAY),
				},
			}),
		)
		const home = await loadFinanceHome()
		const item = home.nextUp.find((i) => i.id === draft.id)
		expect(item).toMatchObject({
			note: "draft",
			step: "LISTS",
			waitingDays: 9,
			href: `/finance/payroll/${draft.id}`,
		})
	})

	it("counts packets in the Inbox and finds the oldest", () => {
		expect(tile(after, "inbox")?.count).toBe(
			(tile(before, "inbox")?.count ?? 0) + 2,
		)
		expect(tile(after, "inbox")?.oldestDays).toBeGreaterThanOrEqual(400)
		expect(tile(after, "inbox")?.href).toBe("/finance/queue")
	})

	it("counts the open PBCC batch's rows and its subtotal, the amount the advance is figured on", () => {
		expect(tile(after, "pbcc_batch")?.count).toBe(
			(tile(before, "pbcc_batch")?.count ?? 0) + 1,
		)
		const gained =
			(tile(after, "pbcc_batch")?.amount ?? 0) -
			(tile(before, "pbcc_batch")?.amount ?? 0)
		// 2 x $100, before IVU
		expect(gained).toBeCloseTo(200, 2)
		expect(PBCC_BATCH_CAPACITY).toBe(100)
	})

	it("makes all three Arm B boxes live", () => {
		expect(tile(after, "pos_to_confirm")).toMatchObject({
			href: "/finance/claro",
		})
		expect(typeof tile(after, "pos_to_confirm")?.count).toBe("number")
		expect(tile(after, "invoices_to_load")).toMatchObject({
			href: "/finance/claro",
		})
		expect(typeof tile(after, "invoices_to_load")?.count).toBe("number")
		expect(tile(after, "claro_past_due")).toMatchObject({
			href: "/finance/ledger?report=aging",
		})
		expect(typeof tile(after, "claro_past_due")?.count).toBe("number")
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

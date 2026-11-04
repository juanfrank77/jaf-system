import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedUser } from "~/test/helpers"
import {
	expectedWire,
	listWireBatches,
	recordWire,
	WireError,
} from "./pbcc-wire.server"

const t = makeTracker()
afterAll(() => t.cleanup())

async function seedBatch(opts: { sent: boolean; advance?: number }) {
	const user = t.track("user", await seedUser({ role: "FINANCE" }))
	const total = 3663.12
	const batch = t.track(
		"bankSchedule",
		await db.bankSchedule.create({
			data: {
				generatedById: user.id,
				advanceRate: 0.8,
				total,
				advanceAmount: opts.advance ?? 2930.5,
				closedAt: new Date("2026-10-26T15:00:00Z"),
				sentAt: opts.sent ? new Date("2026-10-26T16:00:00Z") : null,
			},
		}),
	)
	return batch
}

describe("expectedWire", () => {
	it("is the 80% advance less the $30 fee", () => {
		expect(expectedWire(2930.5)).toBe(2900.5)
	})
})

describe("recordWire", () => {
	it("stores date and amount and reports no difference when the wire matches", async () => {
		const batch = await seedBatch({ sent: true })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const r = await recordWire({
			scheduleId: batch.id,
			receivedOn: "2026-10-29",
			amount: 2900.5,
			userId: carmen.id,
		})
		expect(r).toEqual({ expected: 2900.5, difference: 0 })
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(Number(row.wireAmount)).toBe(2900.5)
		expect(row.wireReceivedAt?.toISOString().slice(0, 10)).toBe("2026-10-29")
		expect(row.wireRecordedById).toBe(carmen.id)
	})

	it("flags a short wire as a negative difference and still stores it", async () => {
		const batch = await seedBatch({ sent: true })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const r = await recordWire({
			scheduleId: batch.id,
			receivedOn: "2026-10-29",
			amount: 2880.5,
			userId: carmen.id,
		})
		expect(r.difference).toBe(-20)
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(Number(row.wireAmount)).toBe(2880.5)
	})

	it("lets Carmen correct a wire she typed wrong", async () => {
		const batch = await seedBatch({ sent: true })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const base = {
			scheduleId: batch.id,
			receivedOn: "2026-10-29",
			userId: carmen.id,
		}
		await recordWire({ ...base, amount: 290.05 })
		await recordWire({ ...base, amount: 2900.5 })
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(Number(row.wireAmount)).toBe(2900.5)
	})

	it("refuses a batch that was never sent to PBCC", async () => {
		const batch = await seedBatch({ sent: false })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		await expect(
			recordWire({
				scheduleId: batch.id,
				receivedOn: "2026-10-29",
				amount: 2900.5,
				userId: carmen.id,
			}),
		).rejects.toMatchObject({ code: "not_sent" })
	})

	it("refuses a zero or negative amount and a bad or future date", async () => {
		const batch = await seedBatch({ sent: true })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const base = { scheduleId: batch.id, userId: carmen.id }
		await expect(
			recordWire({ ...base, receivedOn: "2026-10-29", amount: 0 }),
		).rejects.toMatchObject({ code: "bad_amount" })
		await expect(
			recordWire({ ...base, receivedOn: "not a date", amount: 10 }),
		).rejects.toMatchObject({ code: "bad_date" })
		await expect(
			recordWire({ ...base, receivedOn: "2999-01-01", amount: 10 }),
		).rejects.toBeInstanceOf(WireError)
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(row.wireAmount).toBeNull()
	})
})

describe("listWireBatches", () => {
	it("lists only sent batches with sold, advance, expected wire and difference", async () => {
		const sent = await seedBatch({ sent: true })
		const unsent = await seedBatch({ sent: false })
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		await recordWire({
			scheduleId: sent.id,
			receivedOn: "2026-10-29",
			amount: 2880.5,
			userId: carmen.id,
		})
		const rows = await listWireBatches()
		const mine = rows.find((r) => r.id === sent.id)
		expect(mine).toMatchObject({
			total: 3663.12,
			advance: 2930.5,
			held: 732.62,
			expected: 2900.5,
			wireAmount: 2880.5,
			difference: -20,
		})
		expect(mine?.wireReceivedOn).toBe("2026-10-29")
		expect(rows.some((r) => r.id === unsent.id)).toBe(false)
	})
})

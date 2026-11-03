import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.comptroller.pbcc-wires"

const t = makeTracker()
afterAll(() => t.cleanup())

const post = (fields: Record<string, string>) =>
	action({
		request: new Request("http://x/comptroller/pbcc-wires", {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
		params: {},
		context: {},
	} as never)

async function sentBatch() {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	return t.track(
		"bankSchedule",
		await db.bankSchedule.create({
			data: {
				generatedById: finance.id,
				advanceRate: 0.8,
				total: 3663.12,
				advanceAmount: 2930.5,
				closedAt: new Date("2026-10-26T15:00:00Z"),
				sentAt: new Date("2026-10-26T16:00:00Z"),
			},
		}),
	)
}

describe("/comptroller/pbcc-wires", () => {
	let carmen: Awaited<ReturnType<typeof seedUser>>
	beforeEach(async () => {
		carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		mocks.requireRole.mockResolvedValue({ user: carmen })
	})

	it("is Carmen's and the admin's only", async () => {
		await loader({
			request: new Request("http://x"),
			params: {},
			context: {},
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})

	it("saves the typed date and amount and reports the difference", async () => {
		const batch = await sentBatch()
		const r = await post({
			scheduleId: batch.id,
			receivedOn: "2026-10-29",
			amount: "2,900.50",
		})
		expect(r).toMatchObject({
			scheduleId: batch.id,
			expected: 2900.5,
			difference: 0,
		})
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(Number(row.wireAmount)).toBe(2900.5)
	})

	it("answers a bad amount with a message and writes nothing", async () => {
		const batch = await sentBatch()
		const r = await post({
			scheduleId: batch.id,
			receivedOn: "2026-10-29",
			amount: "abc",
		})
		expect(r).toMatchObject({ errorKey: "pbcc_wires.errors.bad_amount" })
		const row = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batch.id },
		})
		expect(row.wireAmount).toBeNull()
	})
})

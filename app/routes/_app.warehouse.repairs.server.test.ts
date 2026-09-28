import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.warehouse.repairs"

const RUN = runToken("RP")
const t = makeTracker()
let SC_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
})
afterAll(() => t.cleanup())

describe("warehouse repairs route", () => {
	it("correct_triage moves an AWAITING_REPAIR unit back to WAREHOUSE", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "R" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "R" },
			}),
		)
		await t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: user.id, warehouseId: wh.id, isLead: true },
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })
		const serial = `${RUN}-1`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const req = new Request("http://localhost/warehouse/repairs", {
			method: "POST",
			body: new URLSearchParams({
				intent: "correct_triage",
				serial,
				reason: "not failed",
			}),
		})
		await action({ request: req, params: {}, context: {} } as never)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})
})

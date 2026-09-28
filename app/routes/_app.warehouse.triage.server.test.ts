import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

// Follow the repo convention: route tests mock the auth boundary rather than
// mint a real better-auth session. getActiveWarehouseId is left real and
// resolves against a real WarehouseAssignment row.
const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.warehouse.triage"

const RUN = runToken("TQ")
const t = makeTracker()
let SC_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
})
afterAll(() => t.cleanup())

describe("warehouse triage route", () => {
	it("dispositions a RETURNED unit as GOOD → WAREHOUSE", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "T" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "WH" },
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
					status: "RETURNED",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const req = new Request("http://localhost/warehouse/triage", {
			method: "POST",
			body: new URLSearchParams({ serial, disposition: "GOOD" }),
		})
		await action({ request: req, params: {}, context: {} } as never)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})
})

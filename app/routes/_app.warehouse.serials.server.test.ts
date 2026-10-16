import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.warehouse.serials"

const t = makeTracker()
afterAll(() => t.cleanup())

function req(url: string, cookie?: string) {
	return new Request(url, { headers: cookie ? { cookie } : undefined })
}

describe("serial register loader", () => {
	it("returns an empty scope when the user has no warehouse assignment", async () => {
		const worker = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		mocks.requireRole.mockResolvedValue({ user: worker })

		const data = await loader({
			request: req("http://x/warehouse/serials"),
			params: {},
			context: {},
		} as never)

		expect(data.selectedId).toBeUndefined()
		expect(data.register).toBeNull()
	})

	it("lists serials with their material and status", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead: true },
		})
		const serialized = t.track(
			"serviceCode",
			await seedMaterial({ serialized: true }),
		)
		const serial = `S-${Date.now()}`
		t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: serialized.id,
					status: "WAREHOUSE",
					condition: "NEW",
					currentRef: wh.id,
				},
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })

		const data = await loader({
			request: req("http://x/warehouse/serials", `wh=${wh.id}`),
			params: {},
			context: {},
		} as never)

		const row = data.register?.rows.find((r) => r.serial === serial)
		expect(row?.claroCode).toBe(serialized.claroCode)
		expect(row?.status).toBe("WAREHOUSE")
		expect(data.register?.stats.inWarehouse).toBeGreaterThanOrEqual(1)
	})

	it("leaves another warehouse's stock out of the register", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const other = t.track("warehouse", await seedWarehouse())
		const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead: true },
		})
		const material = t.track(
			"serviceCode",
			await seedMaterial({ serialized: true }),
		)
		const stamp = Date.now()
		for (const [name, ref] of [
			["mine", wh.id],
			["theirs", other.id],
		]) {
			t.track(
				"serialLocation",
				await db.serialLocation.create({
					data: {
						serial: `SC-${stamp}-${name}`,
						serviceCodeId: material.id,
						status: "WAREHOUSE",
						currentRef: ref,
					},
				}),
			)
		}
		mocks.requireRole.mockResolvedValue({ user })

		const data = await loader({
			request: req("http://x/warehouse/serials", `wh=${wh.id}`),
			params: {},
			context: {},
		} as never)

		const serials = data.register?.rows.map((r) => r.serial) ?? []
		expect(serials).toContain(`SC-${stamp}-mine`)
		expect(serials).not.toContain(`SC-${stamp}-theirs`)
	})
})

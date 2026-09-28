import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import { makeTracker, seedUser, seedWarehouse } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("resolveWarehouseScope", () => {
	it("returns all assigned warehouses and honors the cookie selection", async () => {
		const u = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const g = t.track("warehouse", await seedWarehouse())
		const a = t.track("warehouse", await seedWarehouse())
		await db.warehouseAssignment.createMany({
			data: [
				{ userId: u.id, warehouseId: g.id, isLead: true },
				{ userId: u.id, warehouseId: a.id, isLead: false },
			],
		})
		const req = new Request("http://x", { headers: { cookie: `wh=${a.id}` } })
		const scope = await resolveWarehouseScope(db, req, u)
		expect(scope.warehouses.map((w) => w.id).sort()).toEqual(
			[g.id, a.id].sort(),
		)
		expect(scope.selectedId).toBe(a.id)
	})

	it("falls back to the first assignment when the cookie warehouse is not visible", async () => {
		const u = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const g = t.track("warehouse", await seedWarehouse())
		await db.warehouseAssignment.create({
			data: { userId: u.id, warehouseId: g.id, isLead: false },
		})
		const req = new Request("http://x", { headers: { cookie: "wh=not-mine" } })
		expect((await resolveWarehouseScope(db, req, u)).selectedId).toBe(g.id)
	})
})

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

	// The deleted `getActiveWarehouseId` ordered assignments by `createdAt asc`;
	// this helper replaced it with an unordered findMany, so `warehouses[0]` —
	// the no-cookie default — became whatever order Postgres happened to return.
	// That default now decides which warehouse a triage/repair WRITE is
	// attributed to, so it must be deterministic: oldest assignment wins.
	it("defaults to the OLDEST assignment regardless of insertion order", async () => {
		const u = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const older = t.track("warehouse", await seedWarehouse())
		const newer = t.track("warehouse", await seedWarehouse())
		// Inserted newest-first on purpose: an unordered scan returns this row
		// first, so only an explicit `orderBy: { createdAt: "asc" }` picks `older`.
		await db.warehouseAssignment.create({
			data: {
				userId: u.id,
				warehouseId: newer.id,
				isLead: false,
				createdAt: new Date("2025-02-01T00:00:00Z"),
			},
		})
		await db.warehouseAssignment.create({
			data: {
				userId: u.id,
				warehouseId: older.id,
				isLead: false,
				createdAt: new Date("2025-01-01T00:00:00Z"),
			},
		})
		const req = new Request("http://x") // no `wh` cookie → the fallback default
		expect((await resolveWarehouseScope(db, req, u)).selectedId).toBe(older.id)
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

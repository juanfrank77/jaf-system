import { describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { isWarehouseLead } from "~/lib/warehouse-lead.server"

describe("warehouse-lead gating", () => {
	it("returns true for an assigned lead, false for a counter", async () => {
		const wh = await db.warehouse.create({
			data: { name: `L-WH-${Date.now()}`, zone: "L" },
		})
		const lead = await db.user.create({
			data: { role: "WAREHOUSE", email: `l${Date.now()}@x`, name: "L" },
		})
		const counter = await db.user.create({
			data: { role: "WAREHOUSE", email: `c${Date.now()}@x`, name: "C" },
		})
		await db.warehouseAssignment.create({
			data: { userId: lead.id, warehouseId: wh.id, isLead: true },
		})
		await db.warehouseAssignment.create({
			data: { userId: counter.id, warehouseId: wh.id, isLead: false },
		})
		expect(await isWarehouseLead(lead.id, wh.id)).toBe(true)
		expect(await isWarehouseLead(counter.id, wh.id)).toBe(false)
	})
})

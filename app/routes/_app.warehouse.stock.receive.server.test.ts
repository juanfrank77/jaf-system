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

import { action } from "./_app.warehouse.stock.receive"

const t = makeTracker()
afterAll(() => t.cleanup())

function postForm(fields: Record<string, string>) {
	return new Request("http://x/warehouse/stock/receive", {
		method: "POST",
		body: new URLSearchParams(fields),
	})
}

describe("receive delivery", () => {
	it("creates a StockDelivery and RECEIVE movements for each line", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const sc1 = t.track("serviceCode", await seedMaterial())
		const sc2 = t.track("serviceCode", await seedMaterial())
		mocks.requireRole.mockResolvedValue({ user })
		await action({
			request: postForm({
				intent: "receive",
				warehouseId: wh.id,
				reference: "PO-9",
				lines: JSON.stringify([
					{ serviceCodeId: sc1.id, qty: 500 },
					{ serviceCodeId: sc2.id, qty: 20 },
				]),
			}),
			params: {},
			context: {},
		} as never)
		const delivery = await db.stockDelivery.findFirstOrThrow({
			where: { warehouseId: wh.id },
		})
		t.track("stockDelivery", delivery)
		const moves = await db.stockMovement.findMany({
			where: { type: "RECEIVE", warehouseId: wh.id },
		})
		expect(moves).toHaveLength(2)
		expect(moves.every((m) => m.kind === "BULK" && m.qty > 0)).toBe(true)
	})
})

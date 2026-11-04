import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigadeRestock: { findMany: vi.fn() },
		brigadeStockReturn: { findMany: vi.fn() },
		brigade: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/brigade-inventory.server", () => ({
	confirmReturn: vi.fn(),
	markRestockReady: vi.fn(),
	signPickup: vi.fn(),
}))

import {
	confirmReturn,
	markRestockReady,
	signPickup,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import * as route from "./_app.warehouse.brigade-stock"

const wh = { id: "wh-1", role: "WAREHOUSE" }

const post = (fields: [string, string][]) => {
	const form = new FormData()
	for (const [k, v] of fields) form.append(k, v)
	return route.action({
		request: new Request("http://localhost/warehouse/brigade-stock", {
			method: "POST",
			body: form,
		}),
		params: {},
	} as never) as Promise<any>
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireRole).mockResolvedValue({ user: wh, session: {} } as never)
	vi.mocked(markRestockReady).mockResolvedValue({ ok: true })
	vi.mocked(signPickup).mockResolvedValue({ ok: true })
	vi.mocked(confirmReturn).mockResolvedValue({ ok: true })
})

describe("warehouse brigade stock", () => {
	it("is open to the warehouse and admin only", async () => {
		await post([["intent", "ready"]])
		const roles = vi.mocked(requireRole).mock.calls[0][1] as string[]
		expect([...roles].sort()).toEqual(["ADMIN", "WAREHOUSE"])
	})

	it("marks ready, hands over as the warehouse side and confirms a return", async () => {
		await post([
			["intent", "ready"],
			["id", "r1"],
		])
		expect(markRestockReady).toHaveBeenCalledWith("r1", "wh-1")
		await post([
			["intent", "hand_over"],
			["id", "r1"],
		])
		expect(signPickup).toHaveBeenCalledWith("r1", wh, "warehouse")
		await post([
			["intent", "confirm_return"],
			["id", "ret-1"],
		])
		expect(confirmReturn).toHaveBeenCalledWith("ret-1", "wh-1")
	})

	it("hands back the library's error key, and rejects an unknown intent", async () => {
		vi.mocked(markRestockReady).mockResolvedValue({
			ok: false,
			errorKey: "brigade_stock.errors.not_requested",
		})
		expect(
			await post([
				["intent", "ready"],
				["id", "r1"],
			]),
		).toEqual({ errorKey: "brigade_stock.errors.not_requested" })
		expect(await post([["intent", "nope"]])).toEqual({
			errorKey: "brigade_stock.errors.bad_intent",
		})
	})

	it("lists open orders with brigade and material names, and returns to confirm", async () => {
		vi.mocked(db.brigadeRestock.findMany).mockResolvedValue([
			{
				id: "r1",
				status: "READY",
				requestedAt: new Date("2026-11-02T10:00:00Z"),
				warehouseSignedAt: null,
				supervisorSignedAt: null,
				requestedBy: { name: "Charlie González" },
				lines: [{ id: "l1", brigadeId: "b1", serviceCodeId: "m1", qty: 20 }],
			},
		] as never)
		vi.mocked(db.brigadeStockReturn.findMany).mockResolvedValue([
			{
				id: "ret-1",
				brigadeId: "b1",
				serviceCodeId: "m1",
				qty: 4,
				requestedBy: { name: "Charlie González" },
			},
		] as never)
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "ANGEL D JIMENEZ", code: "124" },
		] as never)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "m1", claroCode: "100", name: "ANCHOR", unit: "PZA" },
		] as never)

		const data = (await route.loader({
			request: new Request("http://localhost/warehouse/brigade-stock"),
			params: {},
		} as never)) as any
		expect(data.restocks[0]).toMatchObject({
			id: "r1",
			status: "READY",
			supervisor: "Charlie González",
			warehouseSigned: false,
			lines: [
				{
					brigade: "124 ANGEL D JIMENEZ",
					material: "ANCHOR",
					unit: "PZA",
					qty: 20,
				},
			],
		})
		expect(data.returns[0]).toMatchObject({
			id: "ret-1",
			brigade: "124 ANGEL D JIMENEZ",
			material: "ANCHOR",
			qty: 4,
		})
		expect(JSON.stringify(data)).not.toMatch(/price/i)
	})
})

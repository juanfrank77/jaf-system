import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		brigadeRestock: { findMany: vi.fn() },
		brigadeStockReturn: { findMany: vi.fn() },
		brigadeStockMovement: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/brigade-inventory.server", () => ({
	brigadeBalances: vi.fn(),
	cancelRestock: vi.fn(),
	createRestock: vi.fn(),
	recordCount: vi.fn(),
	requestReturn: vi.fn(),
	supervisorBrigadeIds: vi.fn(),
}))

import {
	brigadeBalances,
	cancelRestock,
	createRestock,
	recordCount,
	requestReturn,
	supervisorBrigadeIds,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import * as route from "./_app.supervisor.stock"

const sup = { id: "sup-1", role: "SUPERVISOR", name: "Charlie González" }

const post = (fields: [string, string][]) => {
	const form = new FormData()
	for (const [k, v] of fields) form.append(k, v)
	return route.action({
		request: new Request("http://localhost/supervisor/stock", {
			method: "POST",
			body: form,
		}),
		params: {},
	} as never) as Promise<any>
}

const load = (query = "") =>
	route.loader({
		request: new Request(`http://localhost/supervisor/stock${query}`),
		params: {},
	} as never) as Promise<any>

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(requireRole).mockResolvedValue({ user: sup, session: {} } as never)
	vi.mocked(createRestock).mockResolvedValue({ ok: true, id: "r1" })
	vi.mocked(cancelRestock).mockResolvedValue({ ok: true })
	vi.mocked(recordCount).mockResolvedValue({ ok: true })
	vi.mocked(requestReturn).mockResolvedValue({ ok: true })
})

describe("POST /supervisor/stock", () => {
	it("is for supervisors only", async () => {
		await post([["intent", "count"]])
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), ["SUPERVISOR"])
	})

	it("builds the restock lines from the posted rows and drops blank ones", async () => {
		const result = await post([
			["intent", "create_restock"],
			["brigadeId", "b1"],
			["serviceCodeId", "m1"],
			["qty", "20"],
			["brigadeId", "b2"],
			["serviceCodeId", "m2"],
			["qty", "10"],
			// An untouched row.
			["brigadeId", ""],
			["serviceCodeId", ""],
			["qty", ""],
		])
		expect(result).toEqual({ ok: true })
		expect(createRestock).toHaveBeenCalledWith("sup-1", [
			{ brigadeId: "b1", serviceCodeId: "m1", qty: 20 },
			{ brigadeId: "b2", serviceCodeId: "m2", qty: 10 },
		])
	})

	it("can cancel, and has no pickup to sign: the crew signs at the warehouse", async () => {
		expect(
			await post([
				["intent", "sign_pickup"],
				["id", "r1"],
			]),
		).toEqual({
			errorKey: "brigade_stock.errors.bad_intent",
		})
		await post([
			["intent", "cancel_restock"],
			["id", "r1"],
		])
		expect(cancelRestock).toHaveBeenCalledWith("r1", "sup-1")
	})

	it("passes a count with its reason, and a return with its quantity", async () => {
		await post([
			["intent", "count"],
			["brigadeId", "b1"],
			["serviceCodeId", "m1"],
			["counted", "6"],
			["reason", "damaged"],
		])
		expect(recordCount).toHaveBeenCalledWith({
			brigadeId: "b1",
			serviceCodeId: "m1",
			counted: 6,
			reason: "damaged",
			supervisorId: "sup-1",
		})
		await post([
			["intent", "return"],
			["brigadeId", "b1"],
			["serviceCodeId", "m1"],
			["qty", "4"],
		])
		expect(requestReturn).toHaveBeenCalledWith({
			brigadeId: "b1",
			serviceCodeId: "m1",
			qty: 4,
			supervisorId: "sup-1",
		})
	})

	it("hands back the error key the library gave, and rejects an unknown intent", async () => {
		vi.mocked(recordCount).mockResolvedValue({
			ok: false,
			errorKey: "brigade_stock.errors.reason_required",
		})
		expect(
			await post([
				["intent", "count"],
				["counted", "1"],
			]),
		).toEqual({ errorKey: "brigade_stock.errors.reason_required" })
		expect(await post([["intent", "nope"]])).toEqual({
			errorKey: "brigade_stock.errors.bad_intent",
		})
	})
})

describe("GET /supervisor/stock", () => {
	beforeEach(() => {
		vi.mocked(supervisorBrigadeIds).mockResolvedValue(["b1", "b2"])
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "ANGEL D JIMENEZ", code: "124" },
			{ id: "b2", name: "JESUS MARTINEZ", code: "009" },
		] as never)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "m1", claroCode: "100", name: "ANCHOR", unit: "PZA" },
			{ id: "m2", claroCode: "200", name: "TIE WRAP", unit: "PZA" },
		] as never)
		vi.mocked(db.brigadeRestock.findMany).mockResolvedValue([])
		vi.mocked(db.brigadeStockReturn.findMany).mockResolvedValue([])
		vi.mocked(db.brigadeStockMovement.findMany).mockResolvedValue([])
		vi.mocked(brigadeBalances).mockResolvedValue([
			{ brigadeId: "b2", serviceCodeId: "m2", balance: 30, lastCountAt: null },
			{
				brigadeId: "b1",
				serviceCodeId: "m1",
				balance: 8,
				lastCountAt: new Date("2026-11-02T10:00:00Z"),
			},
		])
	})

	it("only loads the supervisor's own brigades, and shows no prices", async () => {
		const data = await load("?tab=inventory")
		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: ["b1", "b2"] } } }),
		)
		expect(JSON.stringify(data)).not.toMatch(/price/i)
		expect(data.tab).toBe("inventory")
	})

	it("lists balances by brigade name with the material name and last count", async () => {
		const data = await load("?tab=inventory")
		expect(
			data.balances.map((b: any) => [b.brigade, b.material, b.balance]),
		).toEqual([
			["ANGEL D JIMENEZ", "ANCHOR", 8],
			["JESUS MARTINEZ", "TIE WRAP", 30],
		])
		expect(data.balances[0].lastCountAt).toBe("2026-11-02T10:00:00.000Z")
	})

	it("shows each request with its REQ number, and what was given on a short line", async () => {
		vi.mocked(db.brigadeRestock.findMany).mockResolvedValue([
			{
				id: "r1",
				number: "REQ-261110-001",
				status: "PICKED_UP",
				requestedAt: new Date("2026-11-10T13:12:00Z"),
				lines: [
					{
						id: "l1",
						brigadeId: "b1",
						serviceCodeId: "m1",
						qty: 5,
						givenQty: 4,
						note: "out of stock",
					},
				],
			},
		] as never)
		const data = await load()
		expect(data.restocks[0]).toMatchObject({
			number: "REQ-261110-001",
			status: "PICKED_UP",
			requestedBy: sup.name,
			lines: [{ qty: 5, givenQty: 4, note: "out of stock" }],
		})
		expect(data.restocks[0]).not.toHaveProperty("supervisorSigned")
	})

	it("filters by brigade, and the log only opens for one of his brigades", async () => {
		const data = await load("?tab=inventory&brigade=b2")
		expect(data.balances.map((b: any) => b.brigadeId)).toEqual(["b2"])

		await load("?tab=inventory&log=stranger|m1")
		expect(db.brigadeStockMovement.findMany).not.toHaveBeenCalled()
		await load("?tab=inventory&log=b1|m1")
		expect(db.brigadeStockMovement.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { brigadeId: "b1", serviceCodeId: "m1" },
			}),
		)
	})

	it("defaults to the restock tab", async () => {
		expect((await load()).tab).toBe("restock")
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigadeRestock: { findMany: vi.fn(), findUnique: vi.fn() },
		user: { findMany: vi.fn(), findFirst: vi.fn() },
		brigadeStockReturn: { findMany: vi.fn() },
		brigade: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/brigade-inventory.server", () => ({
	confirmReturn: vi.fn(),
	markRestockReady: vi.fn(),
	handOverRestock: vi.fn(),
}))

import {
	confirmReturn,
	handOverRestock,
	markRestockReady,
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
	vi.mocked(handOverRestock).mockResolvedValue({ ok: true })
	vi.mocked(confirmReturn).mockResolvedValue({ ok: true })
})

describe("warehouse brigade stock", () => {
	it("is open to the warehouse and admin only", async () => {
		await post([["intent", "ready"]])
		const roles = vi.mocked(requireRole).mock.calls[0][1] as string[]
		expect([...roles].sort()).toEqual(["ADMIN", "WAREHOUSE"])
	})

	it("marks ready and confirms a return", async () => {
		await post([
			["intent", "ready"],
			["id", "r1"],
		])
		expect(markRestockReady).toHaveBeenCalledWith("r1", "wh-1")
		await post([
			["intent", "confirm_return"],
			["id", "ret-1"],
		])
		expect(confirmReturn).toHaveBeenCalledWith("ret-1", "wh-1")
	})

	describe("hand over", () => {
		const fields = (over: Record<string, string> = {}): [string, string][] =>
			Object.entries({
				intent: "hand_over",
				id: "r1",
				releasedById: "wh-2",
				crewSigner: "b1:name",
				releaseSignature: "data:image/png;base64,AA",
				crewSignature: "data:image/png;base64,BB",
				lines: JSON.stringify([
					{ lineId: "l1", givenQty: 4, note: "out of stock" },
				]),
				...over,
			})

		beforeEach(() => {
			vi.mocked(db.brigadeRestock.findUnique).mockResolvedValue({
				id: "r1",
				lines: [{ id: "l1", brigadeId: "b1", qty: 5 }],
			} as never)
			vi.mocked(db.brigade.findMany).mockResolvedValue([
				{
					id: "b1",
					name: "ANGEL D JIMENEZ",
					code: "124",
					leadName: "Edgard Ocasio",
					memberIds: [],
				},
			] as never)
			vi.mocked(db.user.findMany).mockResolvedValue([])
			vi.mocked(db.user.findFirst).mockResolvedValue({ id: "wh-2" } as never)
		})

		it("signs for the crew member picked on the form, with the chosen warehouse signer", async () => {
			expect(await post(fields())).toEqual({ ok: true })
			expect(handOverRestock).toHaveBeenCalledWith({
				id: "r1",
				releasedById: "wh-2",
				crewSignerName: "Edgard Ocasio",
				crewSignerBrigadeId: "b1",
				releaseSignature: "data:image/png;base64,AA",
				crewSignature: "data:image/png;base64,BB",
				lines: [{ lineId: "l1", givenQty: 4, note: "out of stock" }],
			})
		})

		it("refuses a crew signer who is not on one of the request's brigades", async () => {
			expect(await post(fields({ crewSigner: "other-brigade:name" }))).toEqual({
				errorKey: "brigade_stock.errors.crew_signer_required",
			})
			expect(handOverRestock).not.toHaveBeenCalled()
		})

		it("refuses a warehouse signer who is not an active warehouse user", async () => {
			vi.mocked(db.user.findFirst).mockResolvedValue(null)
			expect(await post(fields())).toEqual({
				errorKey: "docs_sign.alerts.release_signer_required",
			})
			expect(handOverRestock).not.toHaveBeenCalled()
		})

		it("refuses lines that are not JSON", async () => {
			expect(await post(fields({ lines: "{nope" }))).toEqual({
				errorKey: "brigade_stock.errors.bad_given",
			})
		})
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
				number: "REQ-261102-001",
				status: "READY",
				requestedAt: new Date("2026-11-02T10:00:00Z"),
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
			{
				id: "b1",
				name: "ANGEL D JIMENEZ",
				code: "124",
				leadName: "Edgard Ocasio",
				memberIds: [],
			},
		] as never)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "m1", claroCode: "100", name: "ANCHOR", unit: "PZA" },
		] as never)

		const data = (await route.loader({
			request: new Request("http://localhost/warehouse/brigade-stock"),
			params: {},
		} as never)) as any
		expect(data.restocks[0]).toMatchObject({
			id: "r1",
			number: "REQ-261102-001",
			status: "READY",
			supervisor: "Charlie González",
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

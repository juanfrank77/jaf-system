import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.warehouse.stock.receive"

const t = makeTracker()
const keys: string[] = []
afterAll(async () => {
	await t.cleanup()
	if (keys.length)
		await db.idempotencyKey.deleteMany({ where: { key: { in: keys } } })
})

function postForm(fields: Record<string, string>) {
	return new Request("http://x/warehouse/stock/receive", {
		method: "POST",
		body: new URLSearchParams(fields),
	})
}

function run(fields: Record<string, string>) {
	return action({
		request: postForm(fields),
		params: {},
		context: {},
	} as never) as Promise<{ ok?: boolean; deduped?: boolean; errorKey?: string }>
}

function freshKey() {
	const k = runToken("rcv")
	keys.push(k)
	return k
}

/** A warehouse the user is actually ASSIGNED to (the action's new gate). */
async function seedAssigned() {
	const wh = t.track("warehouse", await seedWarehouse())
	const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
	await t.track(
		"warehouseAssignment",
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead: false },
		}),
	)
	mocks.requireRole.mockResolvedValue({ user })
	return { wh, user }
}

describe("receive delivery", () => {
	it("creates a StockDelivery and RECEIVE movements for each line", async () => {
		const { wh } = await seedAssigned()
		const sc1 = t.track("serviceCode", await seedMaterial())
		const sc2 = t.track("serviceCode", await seedMaterial())
		await run({
			intent: "receive",
			idempotencyKey: freshKey(),
			warehouseId: wh.id,
			reference: "PO-9",
			lines: JSON.stringify([
				{ serviceCodeId: sc1.id, qty: 500 },
				{ serviceCodeId: sc2.id, qty: 20 },
			]),
		})
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

	// Review finding E: warehouseId came straight off the POST body with no
	// check that the acting user is assigned to it — any WAREHOUSE user could
	// fabricate RECEIVE movements into an arbitrary warehouse's ledger.
	it("refuses a warehouse the acting user is not assigned to", async () => {
		await seedAssigned() // user is assigned to a DIFFERENT warehouse
		const other = t.track("warehouse", await seedWarehouse())
		const sc = t.track("serviceCode", await seedMaterial())
		const res = await run({
			idempotencyKey: freshKey(),
			warehouseId: other.id,
			lines: JSON.stringify([{ serviceCodeId: sc.id, qty: 5 }]),
		})
		expect(res.errorKey).toBe("stock.receive.errors.not_assigned")
		expect(
			await db.stockMovement.count({ where: { warehouseId: other.id } }),
		).toBe(0)
	})

	it("rejects a line whose serviceCodeId is not an active catalog row", async () => {
		const { wh } = await seedAssigned()
		const res = await run({
			idempotencyKey: freshKey(),
			warehouseId: wh.id,
			lines: JSON.stringify([{ serviceCodeId: "not-a-real-code", qty: 5 }]),
		})
		expect(res.errorKey).toBe("stock.receive.errors.invalid_service_codes")
		expect(
			await db.stockMovement.count({ where: { warehouseId: wh.id } }),
		).toBe(0)
	})

	it("rejects a negative qty instead of coercing it into a positive credit", async () => {
		const { wh } = await seedAssigned()
		const sc = t.track("serviceCode", await seedMaterial())
		const res = await run({
			idempotencyKey: freshKey(),
			warehouseId: wh.id,
			lines: JSON.stringify([{ serviceCodeId: sc.id, qty: -5 }]),
		})
		expect(res.errorKey).toBe("stock.receive.errors.invalid_qty")
		expect(
			await db.stockMovement.count({ where: { warehouseId: wh.id } }),
		).toBe(0)
	})

	it("requires an idempotency key and dedupes a replayed delivery", async () => {
		const { wh } = await seedAssigned()
		const sc = t.track("serviceCode", await seedMaterial())
		const noKey = await run({
			warehouseId: wh.id,
			lines: JSON.stringify([{ serviceCodeId: sc.id, qty: 7 }]),
		})
		expect(noKey.errorKey).toBe("stock.receive.errors.idempotency_key_required")

		const body = {
			idempotencyKey: freshKey(),
			warehouseId: wh.id,
			lines: JSON.stringify([{ serviceCodeId: sc.id, qty: 7 }]),
		}
		const first = await run(body)
		const replay = await run(body) // a double submit of the SAME delivery
		expect(first.deduped).toBe(false)
		expect(replay.deduped).toBe(true)
		const moves = await db.stockMovement.findMany({
			where: { type: "RECEIVE", warehouseId: wh.id, serviceCodeId: sc.id },
		})
		expect(moves).toHaveLength(1)
		expect(
			await db.stockDelivery.count({ where: { warehouseId: wh.id } }),
		).toBe(1)
		for (const d of await db.stockDelivery.findMany({
			where: { warehouseId: wh.id },
		}))
			t.track("stockDelivery", d)
	})
})

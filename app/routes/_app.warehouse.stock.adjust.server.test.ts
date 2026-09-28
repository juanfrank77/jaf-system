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

import { action } from "./_app.warehouse.stock.adjust"

const t = makeTracker()
const keys: string[] = []
afterAll(async () => {
	await t.cleanup()
	if (keys.length)
		await db.idempotencyKey.deleteMany({ where: { key: { in: keys } } })
})

function postForm(fields: Record<string, string>) {
	return new Request("http://x/warehouse/stock/adjust", {
		method: "POST",
		body: new URLSearchParams(fields),
	})
}

async function seedAt(isLead: boolean) {
	const wh = t.track("warehouse", await seedWarehouse())
	const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
	await t.track(
		"warehouseAssignment",
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead },
		}),
	)
	const sc = t.track("serviceCode", await seedMaterial())
	return { wh, user, sc }
}

describe("adjust-with-reason", () => {
	it("rejects an adjust with no reason", async () => {
		const { wh, user, sc } = await seedAt(true)
		mocks.requireRole.mockResolvedValue({ user })
		const key = runToken("k")
		keys.push(key)
		const res = (await action({
			request: postForm({
				idempotencyKey: key,
				warehouseId: wh.id,
				serviceCodeId: sc.id,
				delta: "-5",
				reason: "",
			}),
			params: {},
			context: {},
		} as never)) as { errorKey?: string }
		expect(res.errorKey).toBe("adjust.reason_required")
	})

	it("posts one ADJUST movement and dedupes a replay", async () => {
		const { wh, user, sc } = await seedAt(true)
		mocks.requireRole.mockResolvedValue({ user })
		const key = runToken("k")
		keys.push(key)
		const body = {
			idempotencyKey: key,
			warehouseId: wh.id,
			serviceCodeId: sc.id,
			delta: "-5",
			reason: "cycle count",
		}
		await action({ request: postForm(body), params: {}, context: {} } as never)
		await action({ request: postForm(body), params: {}, context: {} } as never) // replay
		const moves = await db.stockMovement.findMany({
			where: { type: "ADJUST", serviceCodeId: sc.id },
		})
		expect(moves).toHaveLength(1)
		expect(moves[0].note).toBe("cycle count")
	})

	// Review finding E: `String(form.get("idempotencyKey"))` on a MISSING field
	// produced the literal "null" — one fixed key shared by every such request,
	// so the first adjust succeeded and every later one silently deduped while
	// reporting success (and wrote nothing).
	it("rejects a missing idempotency key instead of coercing null into a fixed key", async () => {
		const { wh, user, sc } = await seedAt(true)
		mocks.requireRole.mockResolvedValue({ user })
		const res = (await action({
			request: postForm({
				warehouseId: wh.id,
				serviceCodeId: sc.id,
				delta: "-5",
				reason: "cycle count",
			}),
			params: {},
			context: {},
		} as never)) as { errorKey?: string }
		expect(res.errorKey).toBe("adjust.idempotency_key_required")
		expect(
			await db.stockMovement.count({ where: { serviceCodeId: sc.id } }),
		).toBe(0)
		// The old bug in one assertion: "null" must never be a usable key.
		expect(
			await db.idempotencyKey.findUnique({ where: { key: "null" } }),
		).toBeNull()
	})

	it("rejects an unknown/inactive serviceCodeId", async () => {
		const { wh, user } = await seedAt(true)
		mocks.requireRole.mockResolvedValue({ user })
		const key = runToken("k")
		keys.push(key)
		const res = (await action({
			request: postForm({
				idempotencyKey: key,
				warehouseId: wh.id,
				serviceCodeId: "not-a-real-code",
				delta: "-5",
				reason: "cycle count",
			}),
			params: {},
			context: {},
		} as never)) as { errorKey?: string }
		expect(res.errorKey).toBe("adjust.invalid_service_code")
	})

	it("forbids a non-lead counter", async () => {
		const { wh, user, sc } = await seedAt(false)
		mocks.requireRole.mockResolvedValue({ user })
		const key = runToken("k")
		keys.push(key)
		await expect(
			action({
				request: postForm({
					idempotencyKey: key,
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					delta: "1",
					reason: "x",
				}),
				params: {},
				context: {},
			} as never),
		).rejects.toBeTruthy()
	})
})

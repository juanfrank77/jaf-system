/**
 * Brigade stock: restock request → both sign → balance; counts with a reason
 * and a variance; returns the warehouse confirms; field use charged once
 * (real shadow database).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
	brigadeBalances,
	cancelRestock,
	confirmReturn,
	createRestock,
	markRestockReady,
	recordCount,
	requestReturn,
	signPickup,
	syncUsedFromJob,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedBrigade,
	seedMaterial,
	seedUser,
} from "~/test/helpers"

const HOOK_TIMEOUT = 60_000
const t = makeTracker()

let sup: { id: string }
let other: { id: string }
let wh: { id: string }
let angel: { id: string }
let stranger: { id: string }
let anchor: { id: string }
let wrap: { id: string }

const balance = async (brigadeId: string, serviceCodeId: string) =>
	(await brigadeBalances(db, [brigadeId])).find(
		(b) => b.serviceCodeId === serviceCodeId,
	)?.balance

beforeAll(async () => {
	// The shadow database is shared with test files running in parallel; keep
	// the "restock requested" alert to this file's own warehouse user.
	const createMany = db.notification.createMany.bind(db.notification)
	vi.spyOn(db.notification, "createMany").mockImplementation(((args: {
		data: { userId: string }[]
	}) =>
		createMany({
			...args,
			data: args.data.filter((d) => d.userId === wh.id),
		} as never)) as never)
	sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	other = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	wh = t.track("user", await seedUser({ role: "WAREHOUSE" }))
	angel = t.track("brigade", await seedBrigade({ supervisorId: sup.id }))
	stranger = t.track(
		"brigade",
		await seedBrigade({ supervisorId: other.id, area: null }),
	)
	anchor = t.track("serviceCode", await seedMaterial({ name: "ANCHOR" }))
	wrap = t.track("serviceCode", await seedMaterial({ name: "TIE WRAP" }))
}, HOOK_TIMEOUT)

afterAll(async () => {
	vi.restoreAllMocks()
	const brigadeIds = [angel.id, stranger.id]
	await db.brigadeStockMovement.deleteMany({
		where: { brigadeId: { in: brigadeIds } },
	})
	await db.brigadeStockReturn.deleteMany({
		where: { brigadeId: { in: brigadeIds } },
	})
	await db.brigadeRestock.deleteMany({
		where: { requestedById: { in: [sup.id, other.id] } },
	})
	await t.cleanup()
}, HOOK_TIMEOUT)

describe("restock request", () => {
	it("refuses a brigade that is not the supervisor's, and empty or bad lines", async () => {
		const line = { serviceCodeId: anchor.id, qty: 5 }
		expect(await createRestock(sup.id, [])).toMatchObject({ ok: false })
		expect(
			await createRestock(sup.id, [{ ...line, brigadeId: stranger.id }]),
		).toMatchObject({ errorKey: "brigade_stock.errors.not_your_brigade" })
		expect(
			await createRestock(sup.id, [{ ...line, brigadeId: angel.id, qty: 0 }]),
		).toMatchObject({ errorKey: "brigade_stock.errors.bad_qty" })
		expect(
			await createRestock(sup.id, [
				{ brigadeId: angel.id, serviceCodeId: "nope", qty: 1 },
			]),
		).toMatchObject({ errorKey: "brigade_stock.errors.bad_material" })
	})

	it("adds to the balance only once both sides have signed, and only once", async () => {
		const made = await createRestock(sup.id, [
			{ brigadeId: angel.id, serviceCodeId: anchor.id, qty: 20 },
			{ brigadeId: angel.id, serviceCodeId: wrap.id, qty: 10 },
		])
		if (!made.ok || !made.id) throw new Error("not created")
		const id = made.id

		// Not ready yet: nobody can sign.
		expect(await signPickup(id, sup, "supervisor")).toMatchObject({ ok: false })
		expect(await markRestockReady(id, wh.id)).toEqual({ ok: true })
		expect(await markRestockReady(id, wh.id)).toMatchObject({ ok: false })
		const alert = await db.notification.findFirst({
			where: { userId: sup.id, message: { contains: "ready" } },
		})
		expect(alert).not.toBeNull()

		// Only the requester signs for the supervisor side.
		expect(await signPickup(id, other, "supervisor")).toMatchObject({
			errorKey: "brigade_stock.errors.not_yours",
		})
		expect(await signPickup(id, sup, "supervisor")).toEqual({ ok: true })
		expect(await signPickup(id, sup, "supervisor")).toMatchObject({
			ok: false,
		})
		expect(await balance(angel.id, anchor.id)).toBeUndefined()

		expect(await signPickup(id, wh, "warehouse")).toEqual({ ok: true })
		expect(await balance(angel.id, anchor.id)).toBe(20)
		expect(await balance(angel.id, wrap.id)).toBe(10)
		expect(await signPickup(id, wh, "warehouse")).toMatchObject({ ok: false })
		expect(await balance(angel.id, anchor.id)).toBe(20)

		const done = await db.brigadeRestock.findUniqueOrThrow({ where: { id } })
		expect(done.status).toBe("PICKED_UP")
	})

	it("can be cancelled until someone signs", async () => {
		const made = await createRestock(sup.id, [
			{ brigadeId: angel.id, serviceCodeId: wrap.id, qty: 3 },
		])
		if (!made.ok || !made.id) throw new Error("not created")
		expect(await cancelRestock(made.id, other.id)).toMatchObject({ ok: false })
		expect(await cancelRestock(made.id, sup.id)).toEqual({ ok: true })
		expect(await markRestockReady(made.id, wh.id)).toMatchObject({ ok: false })
	})
})

describe("counts", () => {
	it("the first count is the opening count; a later count that differs needs a reason and keeps the variance", async () => {
		const mat = t.track("serviceCode", await seedMaterial({ name: "CLAMP" }))
		const base = {
			brigadeId: angel.id,
			serviceCodeId: mat.id,
			supervisorId: sup.id,
		}
		expect(await recordCount({ ...base, counted: 8, reason: null })).toEqual({
			ok: true,
		})
		expect(await balance(angel.id, mat.id)).toBe(8)

		expect(
			await recordCount({ ...base, counted: 6, reason: " " }),
		).toMatchObject({ errorKey: "brigade_stock.errors.reason_required" })
		expect(await balance(angel.id, mat.id)).toBe(8)

		expect(
			await recordCount({ ...base, counted: 6, reason: "damaged" }),
		).toEqual({ ok: true })
		expect(await balance(angel.id, mat.id)).toBe(6)

		const last = await db.brigadeStockMovement.findFirstOrThrow({
			where: { brigadeId: angel.id, serviceCodeId: mat.id },
			orderBy: { at: "desc" },
		})
		expect(last).toMatchObject({
			type: "COUNT",
			qty: -2,
			expectedQty: 8,
			countedQty: 6,
			reason: "damaged",
		})

		// A matching count needs no reason.
		expect(await recordCount({ ...base, counted: 6, reason: null })).toEqual({
			ok: true,
		})
		const row = (await brigadeBalances(db, [angel.id])).find(
			(b) => b.serviceCodeId === mat.id,
		)
		expect(row?.lastCountAt).toBeInstanceOf(Date)
	})

	it("refuses a brigade that is not the supervisor's", async () => {
		expect(
			await recordCount({
				brigadeId: stranger.id,
				serviceCodeId: anchor.id,
				counted: 1,
				reason: null,
				supervisorId: sup.id,
			}),
		).toMatchObject({ errorKey: "brigade_stock.errors.not_your_brigade" })
	})
})

describe("returns", () => {
	it("subtract only when the warehouse confirms, never below what the brigade holds", async () => {
		const mat = t.track("serviceCode", await seedMaterial({ name: "BOLT" }))
		const base = { brigadeId: angel.id, serviceCodeId: mat.id }
		await recordCount({
			...base,
			counted: 10,
			reason: null,
			supervisorId: sup.id,
		})

		expect(
			await requestReturn({ ...base, qty: 11, supervisorId: sup.id }),
		).toMatchObject({ errorKey: "brigade_stock.errors.return_exceeds_balance" })
		expect(
			await requestReturn({ ...base, qty: 4, supervisorId: sup.id }),
		).toEqual({
			ok: true,
		})
		expect(await balance(angel.id, mat.id)).toBe(10)

		const pending = await db.brigadeStockReturn.findFirstOrThrow({
			where: { ...base, confirmedAt: null },
		})
		expect(await confirmReturn(pending.id, wh.id)).toEqual({ ok: true })
		expect(await balance(angel.id, mat.id)).toBe(6)
		expect(await confirmReturn(pending.id, wh.id)).toMatchObject({ ok: false })
		expect(await balance(angel.id, mat.id)).toBe(6)
	})
})

describe("used on a job", () => {
	it("charges each crew's truck stock once and follows edits", async () => {
		const mat = t.track("serviceCode", await seedMaterial({ name: "STRAP" }))
		const second = t.track(
			"brigade",
			await seedBrigade({ supervisorId: sup.id }),
		)
		for (const b of [angel.id, second.id])
			await recordCount({
				brigadeId: b,
				serviceCodeId: mat.id,
				counted: 20,
				reason: null,
				supervisorId: sup.id,
			})
		const doc = (angelQty: number, secondQty: number) => ({
			id: "doc-used-test",
			brigadeId: angel.id,
			fieldMaterials: [
				// No brigadeId: the lead crew.
				{
					serviceCodeId: mat.id,
					used: angelQty,
					returned: 0,
					source: "TRUCK_STOCK",
				},
				{
					serviceCodeId: mat.id,
					used: secondQty,
					returned: 0,
					source: "TRUCK_STOCK",
					brigadeId: second.id,
				},
				// Warehouse issue is billed, not charged to the truck.
				{
					serviceCodeId: mat.id,
					used: 99,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
			],
		})

		await syncUsedFromJob(doc(7, 3), sup.id)
		await syncUsedFromJob(doc(7, 3), sup.id)
		expect(await balance(angel.id, mat.id)).toBe(13)
		expect(await balance(second.id, mat.id)).toBe(17)

		await syncUsedFromJob(doc(5, 0), sup.id)
		expect(await balance(angel.id, mat.id)).toBe(15)
		expect(await balance(second.id, mat.id)).toBe(20)

		await db.brigadeStockMovement.deleteMany({
			where: { brigadeId: second.id },
		})
		await db.brigade.delete({ where: { id: second.id } })
	})
})

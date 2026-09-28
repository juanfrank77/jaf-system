import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"

const TAG = `whf-${Date.now()}`
const userIds: string[] = []
const whIds: string[] = []
const vanIds: string[] = []

async function seedUser() {
	const u = await db.user.create({
		data: {
			email: `${TAG}-${Math.random()}@x.test`,
			name: "WHF",
			role: "WAREHOUSE",
		},
	})
	userIds.push(u.id)
	return u
}
async function seedWarehouse() {
	const w = await db.warehouse.create({
		data: { name: `${TAG}-wh`, zone: "Z" },
	})
	whIds.push(w.id)
	return w
}
async function seedVan() {
	const v = await db.van.create({ data: { name: `${TAG}-van` } })
	vanIds.push(v.id)
	return v
}

afterAll(async () => {
	await db.stockMovement.deleteMany({ where: { serviceCodeId: TAG } })
	await db.serialLocation.deleteMany({ where: { serviceCodeId: TAG } })
	await db.repairBatch.deleteMany({ where: { claroReference: TAG } })
	await db.repairIntake.deleteMany({ where: { claroReference: TAG } })
	await db.stockDelivery.deleteMany({ where: { reference: TAG } })
	await db.stockSnapshot.deleteMany({ where: { csvPath: TAG } })
	await db.idempotencyKey.deleteMany({ where: { scope: TAG } })
	await db.van.deleteMany({ where: { id: { in: vanIds } } })
	await db.warehouse.deleteMany({ where: { id: { in: whIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
})

describe("warehouse foundation schema", () => {
	it("creates a BULK warehouse movement (warehouseId set, vanId null)", async () => {
		const u = await seedUser()
		const w = await seedWarehouse()
		const m = await db.stockMovement.create({
			data: {
				warehouseId: w.id,
				kind: "BULK",
				serviceCodeId: TAG,
				qty: 500,
				type: "RECEIVE",
				byUserId: u.id,
			},
		})
		expect(m.kind).toBe("BULK")
		expect(m.vanId).toBeNull()
		expect(m.warehouseId).toBe(w.id)
	})

	it("keeps existing van inserts valid unchanged — kind defaults to SERIAL", async () => {
		const u = await seedUser()
		const v = await seedVan()
		const m = await db.stockMovement.create({
			// no kind, no warehouseId — exactly how Installer writes today
			data: {
				vanId: v.id,
				serviceCodeId: TAG,
				qty: 1,
				serial: `${TAG}-p`,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		expect(m.kind).toBe("SERIAL")
		expect(m.warehouseId).toBeNull()
	})

	it("scopes warehouse BULK on-hand by warehouseId+kind, excluding van rows", async () => {
		const u = await seedUser()
		const w = await seedWarehouse()
		const v = await seedVan()
		await db.stockMovement.create({
			data: {
				warehouseId: w.id,
				kind: "BULK",
				serviceCodeId: TAG,
				qty: 40,
				type: "RECEIVE",
				byUserId: u.id,
			},
		})
		await db.stockMovement.create({
			data: {
				vanId: v.id,
				kind: "BULK",
				serviceCodeId: TAG,
				qty: 7,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		const agg = await db.stockMovement.aggregate({
			where: { kind: "BULK", warehouseId: w.id, serviceCodeId: TAG },
			_sum: { qty: true },
		})
		expect(agg._sum.qty).toBe(40) // van row (warehouseId null) excluded
	})

	it("supports new SerialStatus, condition, and new movement types", async () => {
		const u = await seedUser()
		const w = await seedWarehouse()
		const sl = await db.serialLocation.create({
			data: {
				serial: `${TAG}-sl`,
				serviceCodeId: TAG,
				status: "AWAITING_REPAIR",
				condition: "NEW",
				currentRef: w.id,
			},
		})
		expect(sl.condition).toBe("NEW")
		expect(sl.status).toBe("AWAITING_REPAIR")
		const disp = await db.stockMovement.create({
			data: {
				warehouseId: w.id,
				kind: "SERIAL",
				serviceCodeId: TAG,
				qty: 0,
				serial: sl.serial,
				type: "DISPOSITION",
				byUserId: u.id,
			},
		})
		expect(disp.type).toBe("DISPOSITION")
	})

	it("creates the five new tables", async () => {
		const u = await seedUser()
		const w = await seedWarehouse()
		const batch = await db.repairBatch.create({
			data: {
				warehouseId: w.id,
				status: "SENT",
				createdById: u.id,
				sentAt: new Date(),
				claroReference: TAG,
			},
		})
		expect(batch.status).toBe("SENT")
		const intake = await db.repairIntake.create({
			data: {
				warehouseId: w.id,
				receivedById: u.id,
				receivedAt: new Date(),
				declaredCount: 3,
				claroReference: TAG,
			},
		})
		expect(intake.declaredCount).toBe(3)
		const delivery = await db.stockDelivery.create({
			data: { warehouseId: w.id, receivedById: u.id, reference: TAG },
		})
		expect(delivery.reference).toBe(TAG)
		const snap = await db.stockSnapshot.create({
			data: {
				warehouseId: w.id,
				asOfDate: new Date(),
				generatedById: u.id,
				csvPath: TAG,
			},
		})
		expect(snap.csvPath).toBe(TAG)
		const idem = await db.idempotencyKey.create({
			data: { key: `${TAG}-k`, scope: TAG },
		})
		expect(idem.scope).toBe(TAG)
	})
})

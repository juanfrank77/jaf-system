import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"

const TAG = `whi-${Date.now()}`
const userIds: string[] = []
const whIds: string[] = []
const vanIds: string[] = []

async function seedUser() {
	const u = await db.user.create({
		data: {
			email: `${TAG}-${Math.random()}@x.test`,
			name: "WHI",
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
	await db.van.deleteMany({ where: { id: { in: vanIds } } })
	await db.warehouse.deleteMany({ where: { id: { in: whIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
})

describe("stock_movement location CHECK", () => {
	it("rejects a row with BOTH vanId and warehouseId", async () => {
		const u = await seedUser()
		const v = await seedVan()
		const w = await seedWarehouse()
		await expect(
			db.stockMovement.create({
				data: {
					vanId: v.id,
					warehouseId: w.id,
					kind: "BULK",
					serviceCodeId: TAG,
					qty: 1,
					type: "RECEIVE",
					byUserId: u.id,
				},
			}),
		).rejects.toThrow()
	})

	it("rejects a row with NEITHER vanId nor warehouseId", async () => {
		const u = await seedUser()
		await expect(
			db.stockMovement.create({
				data: {
					kind: "BULK",
					serviceCodeId: TAG,
					qty: 1,
					type: "ADJUST",
					byUserId: u.id,
				},
			}),
		).rejects.toThrow()
	})
})

describe("kind backfill predicate", () => {
	it("sets BULK for serial-null rows only, leaving serialized rows SERIAL", async () => {
		const u = await seedUser()
		const v = await seedVan()
		// simulate legacy rows written before the backfill (kind explicitly SERIAL)
		const accessory = await db.stockMovement.create({
			data: {
				vanId: v.id,
				kind: "SERIAL",
				serviceCodeId: TAG,
				qty: 5,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		const serialized = await db.stockMovement.create({
			data: {
				vanId: v.id,
				kind: "SERIAL",
				serviceCodeId: TAG,
				qty: 1,
				serial: `${TAG}-s`,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		// replay the migration's backfill predicate (scoped to TAG so it is safe in the shared dev DB)
		await db.$executeRawUnsafe(
			`UPDATE "stock_movement" SET "kind" = 'BULK' WHERE "serial" IS NULL AND "serviceCodeId" = $1`,
			TAG,
		)
		expect(
			(
				await db.stockMovement.findUniqueOrThrow({
					where: { id: accessory.id },
				})
			).kind,
		).toBe("BULK")
		expect(
			(
				await db.stockMovement.findUniqueOrThrow({
					where: { id: serialized.id },
				})
			).kind,
		).toBe("SERIAL")
	})
})

describe("kind matches serial invariant (serial IS NULL ⇔ kind = BULK)", () => {
	it("a serialized write (serial set) is stored as kind SERIAL", async () => {
		const u = await seedUser()
		const v = await seedVan()
		const m = await db.stockMovement.create({
			data: {
				vanId: v.id,
				kind: "SERIAL",
				serviceCodeId: TAG,
				qty: 1,
				serial: `${TAG}-inv-s`,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		expect(m.serial).not.toBeNull()
		expect(m.kind).toBe("SERIAL")
	})

	it("a bulk write (no serial) is stored as kind BULK", async () => {
		const u = await seedUser()
		const v = await seedVan()
		const m = await db.stockMovement.create({
			data: {
				vanId: v.id,
				kind: "BULK",
				serviceCodeId: TAG,
				qty: 1,
				type: "PICKUP",
				byUserId: u.id,
			},
		})
		expect(m.serial).toBeNull()
		expect(m.kind).toBe("BULK")
	})

	it("no TAG-scoped row violates serial IS NULL ⇔ kind = BULK", async () => {
		const violations = await db.stockMovement.count({
			where: {
				serviceCodeId: TAG,
				OR: [
					{ serial: null, NOT: { kind: "BULK" } },
					{ NOT: { serial: null }, kind: "BULK" },
				],
			},
		})
		expect(violations).toBe(0)
	})
})

import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { seedServiceCode } from "~/test/helpers" // find-or-create a ServiceCode, returns the row

// Per-run token: server tests share one (Neon dev) DATABASE_URL, and `serial`
// is unique — a fixed serial would collide between the RED and GREEN runs (the
// RED run inserts the SerialLocation before failing on the missing `note`).
const RUN = `T-${Date.now()}`
const SERIAL = `${RUN}-SER-1`
const created = {
	movementIds: [] as string[],
	serialIds: [] as string[],
	batchIds: [] as string[],
	warehouseIds: [] as string[],
	userIds: [] as string[],
}

afterAll(async () => {
	// FK order: movements/serials/batches reference the warehouse (onDelete Restrict).
	if (created.movementIds.length)
		await db.stockMovement.deleteMany({
			where: { id: { in: created.movementIds } },
		})
	if (created.serialIds.length)
		await db.serialLocation.deleteMany({
			where: { id: { in: created.serialIds } },
		})
	if (created.batchIds.length)
		await db.repairBatch.deleteMany({ where: { id: { in: created.batchIds } } })
	if (created.warehouseIds.length)
		await db.warehouse.deleteMany({
			where: { id: { in: created.warehouseIds } },
		})
	if (created.userIds.length)
		await db.user.deleteMany({ where: { id: { in: created.userIds } } })
})

describe("repair schema preconditions", () => {
	it("stores a note on a SENT_FOR_REPAIR serial movement (RepairBatch + condition already exist)", async () => {
		const wh = await db.warehouse.create({
			data: { name: `${RUN}-WH`, zone: "T" },
		})
		created.warehouseIds.push(wh.id)
		const sc = await seedServiceCode("4009642")
		const user = await db.user.create({
			data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "T" },
		})
		created.userIds.push(user.id)
		const batch = await db.repairBatch.create({
			data: {
				warehouseId: wh.id,
				status: "SENT",
				createdById: user.id,
				sentAt: new Date(),
			},
		})
		created.batchIds.push(batch.id)
		const sl = await db.serialLocation.create({
			data: {
				serial: SERIAL,
				serviceCodeId: sc.id,
				status: "SENT_FOR_REPAIR",
				condition: "NEW",
				currentRef: batch.id,
				since: new Date(),
			},
		})
		created.serialIds.push(sl.id)
		const mv = await db.stockMovement.create({
			data: {
				kind: "SERIAL",
				type: "SENT_FOR_REPAIR",
				serial: SERIAL,
				qty: 0,
				serviceCodeId: sc.id,
				warehouseId: wh.id,
				refRepairBatchId: batch.id,
				byUserId: user.id,
				note: "sent in demo batch",
			},
		})
		created.movementIds.push(mv.id)
		expect(sl.status).toBe("SENT_FOR_REPAIR")
		expect(sl.condition).toBe("NEW")
		expect(mv.note).toBe("sent in demo batch") // FAILS until the note column is added
	})
})

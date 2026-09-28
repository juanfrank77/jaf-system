import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	computeTriagePrefill,
	correctTriage,
	createRepairBatch,
	dispositionSerial,
	voidRepairBatch,
} from "~/lib/repair.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

// serviceCodeId is an FK → ServiceCode.id (a cuid). Resolve a real row once.
// byUserId is an FK → User.id, so use a real seeded user (never a literal "u1").
// Serials are unique — per-run tokens keep the file rerunnable on the shared DB.
const RUN = runToken("D")
const t = makeTracker()
let SC_ID: string
let U_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
	U_ID = t.track(
		"user",
		await db.user.create({
			data: { email: `${RUN}-actor@x`, role: "WAREHOUSE", name: "Actor" },
		}),
	).id
})
afterAll(() => t.cleanup())

async function seedReturned(serial: string, wh: string, serviceCodeId = SC_ID) {
	return t.track(
		"serialLocation",
		await db.serialLocation.create({
			data: {
				serial,
				serviceCodeId,
				status: "RETURNED",
				condition: "NEW",
				currentRef: wh,
				since: new Date(),
			},
		}),
	)
}

describe("triage disposition", () => {
	it("FAILED disposition moves RETURNED → AWAITING_REPAIR and writes a movement", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-1`, zone: "D" } }),
		)
		const serial = `${RUN}-S1`
		await seedReturned(serial, wh.id)
		const res = await dispositionSerial({
			serial,
			disposition: "FAILED",
			byUserId: U_ID,
			warehouseId: wh.id,
		})
		expect(res.status).toBe("AWAITING_REPAIR")
		const moves = await db.stockMovement.findMany({
			where: { serial, type: "DISPOSITION" },
		})
		for (const m of moves) t.track("stockMovement", m)
		expect(moves).toHaveLength(1)
		expect(moves[0].kind).toBe("SERIAL")
	})

	it("aborts if the serial is not RETURNED (compare-and-swap)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-2`, zone: "D" } }),
		)
		const serial = `${RUN}-S2`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "WAREHOUSE",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		await expect(
			dispositionSerial({
				serial,
				disposition: "FAILED",
				byUserId: U_ID,
				warehouseId: wh.id,
			}),
		).rejects.toThrow(/expected status RETURNED/)
	})

	it("NEEDS_REVIEW disposition notifies the warehouse lead(s)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-3`, zone: "D" } }),
		)
		const lead = t.track(
			"user",
			await db.user.create({
				data: {
					email: `${RUN}-lead@jaf.test`,
					role: "WAREHOUSE",
					name: "Lead D3",
				},
			}),
		)
		await t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: lead.id, warehouseId: wh.id, isLead: true },
			}),
		)
		const serial = `${RUN}-S3`
		await seedReturned(serial, wh.id)
		await dispositionSerial({
			serial,
			disposition: "NEEDS_REVIEW",
			reason: "removed working",
			byUserId: U_ID,
			warehouseId: wh.id,
		})
		const notes = await db.notification.findMany({ where: { userId: lead.id } })
		expect(notes.length).toBeGreaterThanOrEqual(1)
	})
})

describe("computeTriagePrefill", () => {
	it("defaults to GOOD when the serial was never swapped out (unused van stock)", async () => {
		expect(await computeTriagePrefill(`${RUN}-never-swapped`)).toBe("GOOD")
	})
})

describe("createRepairBatch", () => {
	it("batches only AWAITING_REPAIR units in the same warehouse", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-B1`, zone: "B" } }),
		)
		const serials = [`${RUN}-B1a`, `${RUN}-B1b`]
		for (const s of serials)
			await t.track(
				"serialLocation",
				await db.serialLocation.create({
					data: {
						serial: s,
						serviceCodeId: SC_ID,
						status: "AWAITING_REPAIR",
						condition: "NEW",
						currentRef: wh.id,
						since: new Date(),
					},
				}),
			)
		const { batchId } = await createRepairBatch({
			serials,
			warehouseId: wh.id,
			byUserId: U_ID,
		})
		t.track("repairBatch", { id: batchId })
		const members = await db.stockMovement.findMany({
			where: { refRepairBatchId: batchId, type: "SENT_FOR_REPAIR" },
		})
		expect(members).toHaveLength(2)
		const sl = await db.serialLocation.findUniqueOrThrow({
			where: { serial: serials[0] },
		})
		expect(sl.status).toBe("SENT_FOR_REPAIR")
		expect(sl.currentRef).toBe(batchId)
	})

	it("rejects a GOOD/non-AWAITING unit and commits nothing (CAS)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-B2`, zone: "B" } }),
		)
		const ok = `${RUN}-B3`
		const bad = `${RUN}-B4`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial: ok,
					serviceCodeId: SC_ID,
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial: bad,
					serviceCodeId: SC_ID,
					status: "WAREHOUSE",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		await expect(
			createRepairBatch({
				serials: [ok, bad],
				warehouseId: wh.id,
				byUserId: U_ID,
			}),
		).rejects.toThrow(/expected status AWAITING_REPAIR/)
		const sl = await db.serialLocation.findUniqueOrThrow({
			where: { serial: ok },
		})
		expect(sl.status).toBe("AWAITING_REPAIR") // unchanged — whole tx aborted
	})
})

describe("voidRepairBatch + correctTriage", () => {
	async function batchOne(name: string, serial: string) {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name, zone: "V" } }),
		)
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const { batchId } = await createRepairBatch({
			serials: [serial],
			warehouseId: wh.id,
			byUserId: U_ID,
		})
		t.track("repairBatch", { id: batchId })
		return { wh, batchId }
	}

	it("voids a batch, returning members to AWAITING_REPAIR with a reason", async () => {
		const serial = `${RUN}-V1`
		const { batchId } = await batchOne(`${RUN}-V1wh`, serial)
		await voidRepairBatch({ batchId, reason: "sent in error", byUserId: U_ID })
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("AWAITING_REPAIR")
		const batch = await db.repairBatch.findUniqueOrThrow({
			where: { id: batchId },
		})
		expect(batch.status).toBe("VOIDED")
		expect(batch.voidReason).toBe("sent in error")
	})

	it("blocks void when a member already came back", async () => {
		const serial = `${RUN}-V2`
		const { wh, batchId } = await batchOne(`${RUN}-V2wh`, serial)
		await db.serialLocation.update({
			where: { serial },
			data: {
				status: "WAREHOUSE",
				condition: "REFURBISHED",
				currentRef: wh.id,
			},
		})
		await expect(
			voidRepairBatch({ batchId, reason: "x", byUserId: U_ID }),
		).rejects.toThrow(/already back from repair/)
	})

	it("requires a reason to void", async () => {
		const serial = `${RUN}-V3`
		const { batchId } = await batchOne(`${RUN}-V3wh`, serial)
		await expect(
			voidRepairBatch({ batchId, reason: "  ", byUserId: U_ID }),
		).rejects.toThrow(/reason/)
	})

	it("correctTriage moves an AWAITING_REPAIR unit back to WAREHOUSE with a reason", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-C1`, zone: "V" } }),
		)
		const serial = `${RUN}-C1`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		await correctTriage({
			serial,
			reason: "not actually failed",
			byUserId: U_ID,
			warehouseId: wh.id,
		})
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})
})

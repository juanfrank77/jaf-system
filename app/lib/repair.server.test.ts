import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	computeTriagePrefill,
	correctTriage,
	createRepairBatch,
	dispositionSerial,
	receiveRepairedUnits,
	resolveNeedsReview,
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

	it("composes into a caller-supplied transaction (rolls back with it)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-4`, zone: "D" } }),
		)
		const serial = `${RUN}-S4`
		await seedReturned(serial, wh.id)

		await expect(
			db.$transaction(async (tx) => {
				await dispositionSerial(
					{
						serial,
						disposition: "FAILED",
						byUserId: U_ID,
						warehouseId: wh.id,
					},
					tx,
				)
				throw new Error("rollback")
			}),
		).rejects.toThrow("rollback")

		// If dispositionSerial had opened its own internal transaction instead of
		// using the one it was given, its writes would have committed despite the
		// caller's rollback.
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("RETURNED")
		const moves = await db.stockMovement.findMany({
			where: { serial, type: "DISPOSITION" },
		})
		expect(moves).toHaveLength(0)
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

describe("receiveRepairedUnits", () => {
	it("intake reuses a SENT_FOR_REPAIR serial (history-link) and creates a new one otherwise", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-I1`, zone: "I" } }),
		)
		const oldSerial = `${RUN}-I-old`
		const newSerial = `${RUN}-I-new`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial: oldSerial,
					serviceCodeId: SC_ID,
					status: "SENT_FOR_REPAIR",
					condition: "NEW",
					currentRef: "batchX",
					since: new Date(),
				},
			}),
		)
		const { intakeId } = await receiveRepairedUnits({
			warehouseId: wh.id,
			declaredCount: 2,
			scans: [
				{ serial: oldSerial, serviceCodeId: SC_ID },
				{ serial: newSerial, serviceCodeId: SC_ID },
			],
			byUserId: U_ID,
		})
		const reused = await db.serialLocation.findUniqueOrThrow({
			where: { serial: oldSerial },
		})
		expect(reused.status).toBe("WAREHOUSE")
		expect(reused.condition).toBe("REFURBISHED")
		const trail = await db.stockMovement.findMany({
			where: { serial: oldSerial },
			orderBy: { at: "asc" },
		})
		expect(trail.at(-1)?.type).toBe("REPAIR_INTAKE")
		const created = await db.serialLocation.findUniqueOrThrow({
			where: { serial: newSerial },
		})
		t.track("serialLocation", created)
		expect(created.condition).toBe("REFURBISHED")
		const scanned = await db.stockMovement.count({
			where: { refRepairIntakeId: intakeId, type: "REPAIR_INTAKE" },
		})
		expect(scanned).toBe(2)
	})

	it("requires a note when declared != scanned", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-I2`, zone: "I" } }),
		)
		await expect(
			receiveRepairedUnits({
				warehouseId: wh.id,
				declaredCount: 10,
				scans: [{ serial: `${RUN}-I-9`, serviceCodeId: SC_ID }],
				byUserId: U_ID,
			}),
		).rejects.toThrow(/mismatchNote required/)
	})

	it("flags a serial that is live elsewhere instead of overwriting it", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-I3`, zone: "I" } }),
		)
		const liveSerial = `${RUN}-I-live`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial: liveSerial,
					serviceCodeId: SC_ID,
					status: "INSTALLED",
					condition: "NEW",
					currentRef: "someCompletion",
					since: new Date(),
				},
			}),
		)
		// 1 declared but 0 stocked (the only scan is live-elsewhere) is itself a
		// mismatch (spec §7: scanned = units actually stocked), so a note is required.
		const { flagged } = await receiveRepairedUnits({
			warehouseId: wh.id,
			declaredCount: 1,
			scans: [{ serial: liveSerial, serviceCodeId: SC_ID }],
			mismatchNote: "one unit not returned",
			byUserId: U_ID,
		})
		expect(flagged).toContain(liveSerial)
		const sl = await db.serialLocation.findUniqueOrThrow({
			where: { serial: liveSerial },
		})
		expect(sl.status).toBe("INSTALLED") // untouched
	})

	it("requires a mismatchNote when a scan is skipped live-elsewhere (stocked < declared)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-I4`, zone: "I" } }),
		)
		const live = `${RUN}-I4-live`
		const fresh = `${RUN}-I4-new`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial: live,
					serviceCodeId: SC_ID,
					status: "INSTALLED",
					condition: "NEW",
					currentRef: "c",
					since: new Date(),
				},
			}),
		)
		// declared 2, both scanned, but one is live-elsewhere → only 1 stocked.
		// scans.length (2) would hide this; the check must use the stocked count.
		await expect(
			receiveRepairedUnits({
				warehouseId: wh.id,
				declaredCount: 2,
				scans: [
					{ serial: live, serviceCodeId: SC_ID },
					{ serial: fresh, serviceCodeId: SC_ID },
				],
				byUserId: U_ID,
			}),
		).rejects.toThrow(/mismatchNote required/)
	})
})

describe("resolveNeedsReview", () => {
	it("FAILED sends a NEEDS_REVIEW unit to the repair pool; GOOD returns it to stock", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-NR`, zone: "N" } }),
		)
		const failSerial = `${RUN}-NR-f`
		const goodSerial = `${RUN}-NR-g`
		for (const serial of [failSerial, goodSerial]) {
			await t.track(
				"serialLocation",
				await db.serialLocation.create({
					data: {
						serial,
						serviceCodeId: SC_ID,
						status: "NEEDS_REVIEW",
						condition: "NEW",
						currentRef: wh.id,
						since: new Date(),
					},
				}),
			)
		}
		const f = await resolveNeedsReview({
			serial: failSerial,
			decision: "FAILED",
			byUserId: U_ID,
			warehouseId: wh.id,
		})
		expect(f.status).toBe("AWAITING_REPAIR")
		const g = await resolveNeedsReview({
			serial: goodSerial,
			decision: "GOOD",
			byUserId: U_ID,
			warehouseId: wh.id,
		})
		expect(g.status).toBe("WAREHOUSE")
	})

	it("aborts when the serial is not NEEDS_REVIEW", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-NR2`, zone: "N" } }),
		)
		const serial = `${RUN}-NR2`
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
			resolveNeedsReview({
				serial,
				decision: "GOOD",
				byUserId: U_ID,
				warehouseId: wh.id,
			}),
		).rejects.toThrow(/expected status NEEDS_REVIEW/)
	})
})

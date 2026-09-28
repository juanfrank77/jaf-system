import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { computeTriagePrefill, dispositionSerial } from "~/lib/repair.server"
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

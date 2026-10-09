import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	computeSnapshotAsOf,
	createSnapshot,
	generateSnapshotArtifacts,
} from "~/lib/stock-snapshot.server"
import {
	makeTracker,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const t = makeTracker()
let U_ID: string

beforeAll(async () => {
	U_ID = t.track("user", await seedUser({ role: "WAREHOUSE" })).id
})
afterAll(() => t.cleanup())

describe("computeSnapshotAsOf", () => {
	it("computes on-hand as of a date, ignoring later movements", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const sc = t.track("serviceCode", await seedMaterial())
		await db.stockMovement.create({
			data: {
				kind: "BULK",
				warehouseId: wh.id,
				serviceCodeId: sc.id,
				qty: 500,
				type: "STARTING_BALANCE",
				byUserId: U_ID,
				at: new Date("2026-01-01"),
			},
		})
		await db.stockMovement.create({
			data: {
				kind: "BULK",
				warehouseId: wh.id,
				serviceCodeId: sc.id,
				qty: -100,
				type: "RELEASE",
				byUserId: U_ID,
				at: new Date("2026-03-01"),
			},
		})
		const snap = await computeSnapshotAsOf(db, wh.id, new Date("2026-02-01"))
		expect(snap.bulk.find((b) => b.serviceCodeId === sc.id)?.onHand).toBe(500)
	})
})

describe("snapshot artifacts", () => {
	it("leaves a row with null documentPath if not generated, and generate fills it", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const snap = t.track(
			"stockSnapshot",
			await createSnapshot(db, {
				warehouseId: wh.id,
				asOfDate: new Date(),
				userId: U_ID,
			}),
		)
		expect(snap.documentPath).toBeNull()
		await generateSnapshotArtifacts(db, snap.id)
		const after = await db.stockSnapshot.findUniqueOrThrow({
			where: { id: snap.id },
		})
		expect(after.documentPath).toMatch(/snapshots\//)
		expect(after.csvPath).toMatch(/\.csv$/)
	})
})

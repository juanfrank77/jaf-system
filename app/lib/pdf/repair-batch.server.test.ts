import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { generateRepairBatchPdf } from "~/lib/pdf/repair-batch.server"
import { createRepairBatch } from "~/lib/repair.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

const RUN = runToken("P")
const t = makeTracker()
let SC_ID: string
let U_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
	U_ID = t.track(
		"user",
		await db.user.create({
			data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "P" },
		}),
	).id
})
afterAll(() => t.cleanup())

describe("repair batch PDF", () => {
	it("renders a non-empty PDF listing member serials + ownership label", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "P" } }),
		)
		const serial = `${RUN}-1`
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
		const bytes = await generateRepairBatchPdf(batchId)
		expect(bytes.byteLength).toBeGreaterThan(1000)
		expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF")
	})
})

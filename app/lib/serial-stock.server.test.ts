import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { serializedOnHand } from "~/lib/serial-stock"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

// Two distinct ServiceCode rows; on-hand groups by serviceCodeId (the FK id).
const RUN = runToken("OH")
const t = makeTracker()
let SC_ID: string
let SC2_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
	SC2_ID = (await seedServiceCode("4012210")).id
})
afterAll(() => t.cleanup())

describe("serializedOnHand", () => {
	it("excludes SENT_FOR_REPAIR and splits NEW vs REFURBISHED", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "O" } }),
		)
		for (const data of [
			{
				serial: `${RUN}-1`,
				serviceCodeId: SC_ID,
				status: "WAREHOUSE" as const,
				condition: "NEW" as const,
				currentRef: wh.id,
				since: new Date(),
			},
			{
				serial: `${RUN}-2`,
				serviceCodeId: SC2_ID,
				status: "WAREHOUSE" as const,
				condition: "REFURBISHED" as const,
				currentRef: wh.id,
				since: new Date(),
			},
			{
				serial: `${RUN}-3`,
				serviceCodeId: SC_ID,
				status: "SENT_FOR_REPAIR" as const,
				condition: "NEW" as const,
				currentRef: "b",
				since: new Date(),
			},
		]) {
			await t.track("serialLocation", await db.serialLocation.create({ data }))
		}
		const rows = await serializedOnHand(wh.id)
		expect(
			rows.find((r) => r.serviceCodeId === SC_ID && r.condition === "NEW")
				?.count,
		).toBe(1)
		expect(
			rows.find(
				(r) => r.serviceCodeId === SC2_ID && r.condition === "REFURBISHED",
			)?.count,
		).toBe(1)
		// SENT_FOR_REPAIR excluded
		expect(rows.some((r) => r.serviceCodeId === SC_ID && r.count === 2)).toBe(
			false,
		)
	})
})

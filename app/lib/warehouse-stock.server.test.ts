import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedMaterial,
	seedWarehouse,
} from "~/test/helpers"
import {
	getBulkOnHand,
	getWarehouseBulkStock,
	resolveDualUom,
} from "./warehouse-stock.server"

const RUN = runToken("WS")
const t = makeTracker()
let U_ID: string

beforeAll(async () => {
	U_ID = t.track(
		"user",
		await db.user.create({
			data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "WS" },
		}),
	).id
})
afterAll(() => t.cleanup())

describe("getBulkOnHand", () => {
	it("sums only kind=BULK movements for the warehouse+material", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const sc = t.track("serviceCode", await seedMaterial())
		await db.stockMovement.createMany({
			data: [
				{
					kind: "BULK",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: 500,
					type: "STARTING_BALANCE",
					byUserId: U_ID,
				},
				{
					kind: "BULK",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: -300,
					type: "RELEASE",
					byUserId: U_ID,
				},
				{
					kind: "BULK",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: 40,
					type: "RETURN",
					byUserId: U_ID,
				},
				// a SERIAL row must be ignored:
				{
					kind: "SERIAL",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: 1,
					type: "REPAIR_INTAKE",
					byUserId: U_ID,
					serial: `${RUN}-X1`,
				},
			],
		})
		expect(await getBulkOnHand(db, wh.id, sc.id)).toBe(240)
	})
})

describe("resolveDualUom", () => {
	it("hides the derived stock qty when no conversion factor", () => {
		const r = resolveDualUom(1240, {
			countUnit: "ROLLOS",
			stockUnit: "FT",
			conversionFactor: null,
		})
		expect(r.derivedStockQty).toBeNull()
	})
	// The factor is defined countUnit -> stockUnit (schema doc comment), and the
	// ledger qty IS the count-unit figure — so the derived figure MULTIPLIES.
	it("derives the stock qty as ledgerQty * factor when a factor exists", () => {
		const r = resolveDualUom(10, {
			countUnit: "CAJAS",
			stockUnit: "PZA",
			conversionFactor: 100,
		})
		expect(r.ledgerQty).toBe(10)
		expect(r.countUnit).toBe("CAJAS")
		expect(r.derivedStockQty).toBe(1000)
		expect(r.stockUnit).toBe("PZA")
	})
})

describe("getWarehouseBulkStock", () => {
	it("groups by material, resolves name/UOM, hides derived qty without a factor", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const withFactor = t.track(
			"serviceCode",
			await seedMaterial({
				name: "Cable",
				countUnit: "CAJAS",
				stockUnit: "FT",
				conversionFactor: 100,
			}),
		)
		const noFactor = t.track(
			"serviceCode",
			await seedMaterial({
				name: "Wire",
				countUnit: "ROLLOS",
				stockUnit: "FT",
				conversionFactor: null,
			}),
		)
		await db.stockMovement.createMany({
			data: [
				{
					kind: "BULK",
					warehouseId: wh.id,
					serviceCodeId: withFactor.id,
					qty: 1000,
					type: "STARTING_BALANCE",
					byUserId: U_ID,
				},
				{
					kind: "BULK",
					warehouseId: wh.id,
					serviceCodeId: noFactor.id,
					qty: 500,
					type: "STARTING_BALANCE",
					byUserId: U_ID,
				},
			],
		})
		const rows = await getWarehouseBulkStock(db, wh.id)
		const a = rows.find((r) => r.serviceCodeId === withFactor.id)
		expect(a?.onHand).toBe(1000)
		expect(a?.derivedStockQty).toBe(100_000)
		const b = rows.find((r) => r.serviceCodeId === noFactor.id)
		expect(b?.onHand).toBe(500)
		expect(b?.derivedStockQty).toBeNull()
	})
})

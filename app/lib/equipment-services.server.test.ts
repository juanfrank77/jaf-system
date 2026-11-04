import { describe, expect, it } from "vitest"
import { db } from "./db.server"
import { searchServiceCodes, serviceCodesForRole } from "./service-codes.server"

// The 13 Claro equipment service numbers come from a migration, so they exist
// in every environment: Digger (full day / half day / out of hours) and the two
// trucks.
const EQUIPMENT = {
	"34007042": ["DIGGER Equipment", "Full day", 500, 400],
	"34006172": ["DIGGER Equipment", "Full day", 500, 400],
	"34005914": ["DIGGER Equipment", "Full day", 500, 400],
	"34013800": ["DIGGER Equipment", "Half day", 250, 200],
	"34007051": ["DIGGER Equipment", "Half day", 250, 200],
	"34013801": ["DIGGER Equipment", "Half day", 250, 200],
	"34014138": ["DIGGER Equipment", "Out of business hours", 800, 640],
	"34009677": ["TRUCK BOMM Equipment", "Flat", 250, 200],
	"34009321": ["TRUCK BOMM Equipment", "Flat", 250, 200],
	"34009322": ["TRUCK BOMM Equipment", "Flat", 250, 200],
	"34009678": ["TRUCK BOMM Equipment", "Flat", 250, 200],
	"34009323": ["TRUCK BARRENO Equipment", "Flat", 700, 560],
	"34009324": ["TRUCK BARRENO Equipment", "Flat", 700, 560],
} as const

describe("equipment services", () => {
	it("loads the 13 numbers as tagged, active SERVICE rows with JAF price and the 80% brigade share", async () => {
		const rows = await db.serviceCode.findMany({ where: { equipment: true } })
		expect(rows).toHaveLength(13)
		for (const r of rows) {
			const [name, unit, price, share] =
				EQUIPMENT[r.claroCode as keyof typeof EQUIPMENT]
			expect(r).toMatchObject({ name, unit, kind: "SERVICE", active: true })
			expect(Number(r.unitPrice)).toBe(price)
			expect(Number(r.contractorPrice)).toBe(share)
		}
	})

	it('a supervisor typing "digger" or "truck" finds the equipment lines', async () => {
		const digger = await searchServiceCodes("digger", 20)
		expect(digger.filter((r) => r.equipment)).toHaveLength(7)
		const truck = await searchServiceCodes("truck", 20)
		expect(truck.filter((r) => r.equipment)).toHaveLength(6)
	})

	it("is found by its service number", async () => {
		const [hit] = await searchServiceCodes("34014138")
		expect(hit).toMatchObject({ claroCode: "34014138", equipment: true })
	})

	it("shows no price to a supervisor, and the price to Finance", async () => {
		const rows = await db.serviceCode.findMany({ where: { equipment: true } })
		for (const out of serviceCodesForRole("SUPERVISOR", rows) as any[]) {
			expect(out).not.toHaveProperty("unitPrice")
			expect(out).not.toHaveProperty("contractorPrice")
		}
		const [fin] = serviceCodesForRole("ADMIN", rows)
		expect(fin.unitPrice).toBeGreaterThan(0)
	})
})

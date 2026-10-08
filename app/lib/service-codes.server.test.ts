import { describe, expect, it, vi } from "vitest"

vi.mock("./db.server", () => ({ db: {} }))

import { isPriceBlind, serviceCodesForRole } from "./service-codes.server"

const PRICE_KEYS = [
	"unitPrice",
	"claroBasePrice",
	"upliftFactor",
	"contractorPrice",
	"contractorFactor",
]

function row() {
	return {
		id: "sc-1",
		claroCode: "34006428",
		name: "TRANSFER STITCH",
		unit: "EA",
		unitPrice: "42.3430",
		claroBasePrice: "30.0000",
		upliftFactor: "1.4",
		contractorPrice: "20.0000",
		contractorFactor: "0.6",
		priceListRevision: "R7",
		accountCode: "610",
		countUnit: "EA",
	} as any
}

describe("serviceCodesForRole", () => {
	it.each(["CREW", "WAREHOUSE", "INSTALLER"])(
		"removes every price field for %s and keeps the rest",
		(role) => {
			const [out] = serviceCodesForRole(role, [row()]) as any[]
			for (const k of PRICE_KEYS) expect(k in out).toBe(false)
			expect(out).toMatchObject({
				id: "sc-1",
				claroCode: "34006428",
				name: "TRANSFER STITCH",
				unit: "EA",
				countUnit: "EA",
			})
		},
	)

	it.each(["SUPERVISOR", "FINANCE", "COMPTROLLER", "ADMIN"])(
		"keeps a numeric unitPrice for %s",
		(role) => {
			const [out] = serviceCodesForRole(role, [row()])
			expect(out?.unitPrice).toBe(42.343)
		},
	)

	it("does not mutate the input rows", () => {
		const input = row()
		serviceCodesForRole("CREW", [input])
		expect(input.unitPrice).toBe("42.3430")
		expect(input.contractorPrice).toBe("20.0000")
	})
})

describe("isPriceBlind", () => {
	it("is true only for crew and warehouse", () => {
		expect(isPriceBlind("CREW")).toBe(true)
		expect(isPriceBlind("WAREHOUSE")).toBe(true)
		expect(isPriceBlind("INSTALLER")).toBe(true)
		expect(isPriceBlind("SUPERVISOR")).toBe(false)
		expect(isPriceBlind("ADMIN")).toBe(false)
	})
})

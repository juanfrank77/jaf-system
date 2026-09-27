import { describe, expect, it } from "vitest"
import { parsePaymentDate, paymentForType } from "./payment-records"

describe("payment records (pure helpers)", () => {
	it("parses strict local dates", () => {
		expect(parsePaymentDate("2026-02-28")?.getDate()).toBe(28)
		expect(parsePaymentDate("2026-02-30")).toBeNull()
	})
	it("returns null for an empty/nullish value", () => {
		expect(parsePaymentDate(null)).toBeNull()
		expect(parsePaymentDate(undefined)).toBeNull()
		expect(parsePaymentDate("")).toBeNull()
	})
	it("finds the record matching a payment type, or null", () => {
		const records = [
			{ type: "PBCC_ADVANCE", amount: 10 },
			{ type: "CLARO_FINAL", amount: 20 },
		]
		expect(paymentForType(records, "PBCC_ADVANCE")).toEqual(records[0])
		expect(paymentForType([], "PBCC_ADVANCE")).toBeNull()
	})
})

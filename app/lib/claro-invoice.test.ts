import { describe, expect, it } from "vitest"
import {
	defaultWorkMonth,
	dueDateOf,
	invoiceNumber,
	isWorkMonth,
	usDate,
	workRange,
	zoneOf,
} from "./claro-invoice"

describe("Factura de Pago rules", () => {
	it("formats the M19 number and the zone like the sample", () => {
		expect(invoiceNumber(4320)).toBe("M19-4320")
		expect(zoneOf("2026-05")).toBe("MANT-JAF-MAY-2026")
	})
	it("gives the first and last day of the work month, month-first", () => {
		expect(workRange("2026-05")).toEqual({
			from: "05/01/2026",
			to: "05/31/2026",
		})
		expect(workRange("2028-02")).toEqual({
			from: "02/01/2028",
			to: "02/29/2028",
		})
	})
	it("writes dates month-first", () => {
		expect(usDate(new Date("2026-09-23T15:00:00Z"))).toBe("09/23/2026")
	})
	it("due date is the loaded date plus the PO terms", () => {
		const due = dueDateOf(new Date("2026-09-23T15:00:00Z"), 60)
		expect(due.toISOString().slice(0, 10)).toBe("2026-11-22")
	})
	it("validates work months", () => {
		expect(isWorkMonth("2026-05")).toBe(true)
		expect(isWorkMonth("2026-13")).toBe(false)
		expect(isWorkMonth("05/2026")).toBe(false)
	})
	it("starts from the month work began, else the month before the PO", () => {
		expect(defaultWorkMonth(new Date("2026-05-12T12:00:00Z"), null)).toBe(
			"2026-05",
		)
		expect(defaultWorkMonth(null, new Date("2026-01-04T12:00:00Z"))).toBe(
			"2025-12",
		)
		expect(defaultWorkMonth(null, null)).toBeNull()
	})
})

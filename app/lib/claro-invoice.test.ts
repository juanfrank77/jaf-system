import { describe, expect, it } from "vitest"
import {
	defaultWorkMonth,
	dueDateOf,
	formDate,
	invoiceNumber,
	isWorkMonth,
	nextSeq,
	parseInvoiceRef,
	usDate,
	workRange,
	zoneOf,
} from "./claro-invoice"

describe("Factura de Pago rules", () => {
	it("numbers new invoices M20-001 onward, with no maximum", () => {
		expect(invoiceNumber({ series: "M20", seq: 1 })).toBe("M20-001")
		expect(invoiceNumber({ series: "M20", seq: 999 })).toBe("M20-999")
		expect(invoiceNumber({ series: "M20", seq: 1000 })).toBe("M20-1000")
	})
	it("keeps an old invoice's M19 number", () => {
		expect(invoiceNumber({ series: "M19", seq: 4971 })).toBe("M19-4971")
	})
	it("starts the series at 1 and never resets", () => {
		expect(nextSeq(null)).toBe(1)
		expect(nextSeq(999)).toBe(1000)
	})
	it("reads either series off a Payment Advice or a typed number", () => {
		expect(parseInvoiceRef("M19-3423")).toEqual({ series: "M19", seq: 3423 })
		expect(parseInvoiceRef("M193423")).toEqual({ series: "M19", seq: 3423 })
		expect(parseInvoiceRef("M20-001")).toEqual({ series: "M20", seq: 1 })
		expect(parseInvoiceRef("m20 1000")).toEqual({ series: "M20", seq: 1000 })
		expect(parseInvoiceRef("3423")).toEqual({ series: null, seq: 3423 })
		expect(parseInvoiceRef("M17-10353721")).toBeNull()
		expect(parseInvoiceRef("nope")).toBeNull()
	})
	it("writes the Zona month in Spanish, as on JAF's real invoices", () => {
		expect(zoneOf("2026-07")).toBe("MANT-JAF-JUL-2026")
		expect(zoneOf("2026-04")).toBe("MANT-JAF-ABR-2026")
		expect(zoneOf("2026-01")).toBe("MANT-JAF-ENE-2026")
		expect(zoneOf("2026-08")).toBe("MANT-JAF-AGO-2026")
		expect(zoneOf("2026-12")).toBe("MANT-JAF-DIC-2026")
	})
	it("writes FECHA as MM/DD/YY on the Puerto Rico calendar", () => {
		expect(formDate(new Date("2026-11-04T15:00:00Z"))).toBe("11/04/26")
		// 01:00 UTC on the 5th is still the 4th in Puerto Rico.
		expect(formDate(new Date("2026-11-05T01:00:00Z"))).toBe("11/04/26")
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

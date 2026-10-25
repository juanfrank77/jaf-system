import { describe, expect, it } from "vitest"
import {
	displayRequestLabel,
	formatShortDate,
	highestRequestNumber,
	parsePayrollTab,
	payPeriodLabel,
} from "./payroll-request-view"

describe("payPeriodLabel", () => {
	it("is the fixed two-week period holding today, MM/DD/YYYY", () => {
		expect(payPeriodLabel(new Date("2026-10-25T16:00:00Z"))).toBe(
			"10/12/2026 – 10/25/2026",
		)
	})

	it("reads the Puerto Rico calendar day, not UTC", () => {
		// 01:00 UTC on the 26th is still the evening of the 25th in Puerto Rico.
		expect(payPeriodLabel(new Date("2026-10-26T01:00:00Z"))).toBe(
			"10/12/2026 – 10/25/2026",
		)
	})
})

describe("fixed periods and request numbers", () => {
	it("gives every day of a period the same period, and the next day the next", () => {
		expect(payPeriodLabel(new Date("2026-10-12T16:00:00Z"))).toBe(
			"10/12/2026 – 10/25/2026",
		)
		expect(payPeriodLabel(new Date("2026-10-11T16:00:00Z"))).toBe(
			"09/28/2026 – 10/11/2026",
		)
		expect(payPeriodLabel(new Date("2026-10-26T16:00:00Z"))).toBe(
			"10/26/2026 – 11/08/2026",
		)
	})

	it("numbers requests after the highest PR number, ignoring old titles", () => {
		expect(highestRequestNumber([])).toBe(0)
		expect(
			highestRequestNumber([
				"20261012",
				"10/11/2026 – 10/24/2026",
				"PR0004 · 10/12/2026 – 10/25/2026",
				"PR0002 · x",
			]),
		).toBe(4)
	})
})

describe("parsePayrollTab", () => {
	it("opens on Ready unless asked for Waiting or Paid", () => {
		expect(parsePayrollTab(null)).toBe("ready")
		expect(parsePayrollTab("waiting")).toBe("waiting")
		expect(parsePayrollTab("paid")).toBe("paid")
		expect(parsePayrollTab("nope")).toBe("ready")
	})
})

describe("formatShortDate", () => {
	it("writes the date the JAF way", () => {
		expect(formatShortDate("2026-10-24T14:12:00Z")).toBe("10/24/2026")
	})
})

describe("displayRequestLabel", () => {
	it("reads an old 8-digit title as MM/DD/YYYY and leaves pay periods alone", () => {
		expect(displayRequestLabel("20261012")).toBe("10/12/2026")
		expect(displayRequestLabel("10/10/2026 – 10/23/2026")).toBe(
			"10/10/2026 – 10/23/2026",
		)
	})
})

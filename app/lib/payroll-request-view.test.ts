import { describe, expect, it } from "vitest"
import {
	defaultPeriodLabel,
	formatShortDate,
	parsePayrollTab,
} from "./payroll-request-view"

describe("defaultPeriodLabel", () => {
	it("is the two weeks ending today, MM/DD/YYYY", () => {
		expect(defaultPeriodLabel(new Date("2026-10-25T16:00:00Z"))).toBe(
			"10/12/2026 – 10/25/2026",
		)
	})

	it("reads the Puerto Rico calendar day, not UTC", () => {
		// 01:00 UTC on the 26th is still the evening of the 25th in Puerto Rico.
		expect(defaultPeriodLabel(new Date("2026-10-26T01:00:00Z"))).toBe(
			"10/12/2026 – 10/25/2026",
		)
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

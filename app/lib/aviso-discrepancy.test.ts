import { describe, expect, it } from "vitest"
import { discrepancyAgeDays, isDiscrepancyStale } from "./aviso-discrepancy"

const now = new Date("2026-10-22T12:00:00Z")
const at = (iso: string) => ({
	detectedAt: iso,
	differences: [],
	note: null,
	noteAt: null,
	noteById: null,
})

describe("isDiscrepancyStale", () => {
	it("2 days old is not stale", () => {
		expect(isDiscrepancyStale(at("2026-10-20T12:00:00Z"), now)).toBe(false)
	})
	it("3 days old is stale", () => {
		expect(isDiscrepancyStale(at("2026-10-19T12:00:00Z"), now)).toBe(true)
	})
	it("null is not stale", () => {
		expect(isDiscrepancyStale(null, now)).toBe(false)
	})
	it("ages in whole days", () => {
		expect(discrepancyAgeDays(at("2026-10-19T00:00:00Z"), now)).toBe(3)
	})
})

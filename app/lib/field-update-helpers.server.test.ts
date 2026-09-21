import { describe, expect, it } from "vitest"
import {
	buildAddressCorrection,
	clampUsedToTook,
	formatTimeOnSite,
	mergeAddressCorrections,
	parseGpsCoordinates,
} from "./field-update-helpers"

describe("field-update-helpers", () => {
	describe("buildAddressCorrection", () => {
		it("builds a correction record with original, corrected, user, and timestamp", () => {
			const correction = buildAddressCorrection({
				original: "Cupey, San Juan",
				corrected: "123 Calle Sol, Cupey",
				correctedById: "user1",
			})
			expect(correction.original).toBe("Cupey, San Juan")
			expect(correction.corrected).toBe("123 Calle Sol, Cupey")
			expect(correction.correctedById).toBe("user1")
			expect(correction.correctedAt).toBeTruthy()
			expect(new Date(correction.correctedAt).getTime()).not.toBeNaN()
		})

		it("includes optional GPS coordinates", () => {
			const gps = {
				lat: 18.22,
				lng: -66.05,
				capturedAt: "2026-08-13T12:00:00Z",
			}
			const correction = buildAddressCorrection({
				original: "A",
				corrected: "B",
				correctedById: "user1",
				gps,
			})
			expect(correction.gps).toEqual(gps)
		})
	})

	describe("mergeAddressCorrections", () => {
		it("appends a correction to existing history", () => {
			const existing = [
				{
					original: "A",
					corrected: "B",
					correctedById: "u1",
					correctedAt: "2026-08-01T00:00:00Z",
				},
			]
			const next = buildAddressCorrection({
				original: "B",
				corrected: "C",
				correctedById: "u2",
			})
			const merged = mergeAddressCorrections({ existing, correction: next })
			expect(merged).toHaveLength(2)
			expect(merged[1].corrected).toBe("C")
		})

		it("starts fresh when no history exists", () => {
			const correction = buildAddressCorrection({
				original: "A",
				corrected: "B",
				correctedById: "u1",
			})
			expect(mergeAddressCorrections({ existing: null, correction })).toEqual([
				correction,
			])
		})
	})

	describe("parseGpsCoordinates", () => {
		it("parses valid GPS JSON", () => {
			const raw = JSON.stringify({ lat: 18.22, lng: -66.05, accuracy: 10 })
			const parsed = parseGpsCoordinates(raw)
			expect(parsed).toMatchObject({ lat: 18.22, lng: -66.05, accuracy: 10 })
			expect(parsed?.capturedAt).toBeTruthy()
		})

		it("returns undefined for invalid JSON", () => {
			expect(parseGpsCoordinates("not-json")).toBeUndefined()
		})

		it("returns undefined for missing lat/lng", () => {
			expect(
				parseGpsCoordinates(JSON.stringify({ accuracy: 10 })),
			).toBeUndefined()
		})
	})

	describe("formatTimeOnSite", () => {
		it("returns null when start or end is missing", () => {
			expect(formatTimeOnSite(null, new Date())).toBeNull()
			expect(formatTimeOnSite(new Date(), null)).toBeNull()
		})

		it("formats minutes", () => {
			const start = new Date("2026-08-13T12:00:00Z")
			const end = new Date("2026-08-13T12:30:00Z")
			expect(formatTimeOnSite(start, end)).toBe("30m")
		})

		it("formats hours and minutes", () => {
			const start = new Date("2026-08-13T12:00:00Z")
			const end = new Date("2026-08-13T13:45:00Z")
			expect(formatTimeOnSite(start, end)).toBe("1h 45m")
		})
	})

	describe("clampUsedToTook", () => {
		it("leaves used at or below took", () => {
			expect(clampUsedToTook(2, 5)).toEqual({ qty: 2, clamped: false })
			expect(clampUsedToTook(5, 5)).toEqual({ qty: 5, clamped: false })
		})
		it("snaps used down to took", () => {
			expect(clampUsedToTook(8, 5)).toEqual({ qty: 5, clamped: true })
		})
	})
})

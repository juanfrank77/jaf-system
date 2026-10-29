import { describe, expect, it } from "vitest"
import { weekStrip } from "~/lib/comptroller-home"

describe("weekStrip", () => {
	it("lists the four working days with their jobs", () => {
		const strip = weekStrip(new Date("2026-10-27T16:00:00Z"))
		expect(strip.map((d) => [d.day, d.items])).toEqual([
			["mon", ["ewit"]],
			["tue", ["ewit", "pbcc"]],
			["wed", ["received", "installer_pay"]],
			["thu", ["brigade_pay"]],
		])
	})

	it("marks Tuesday as today on a Tuesday", () => {
		const strip = weekStrip(new Date("2026-10-27T16:00:00Z"))
		expect(strip.filter((d) => d.today).map((d) => d.day)).toEqual(["tue"])
	})

	it("marks nothing on a Sunday", () => {
		const strip = weekStrip(new Date("2026-11-01T16:00:00Z"))
		expect(strip.some((d) => d.today)).toBe(false)
	})

	it("uses the Puerto Rico day, not UTC", () => {
		// 01:00 UTC Wednesday is still Tuesday evening in San Juan.
		const strip = weekStrip(new Date("2026-10-28T01:00:00Z"))
		expect(strip.filter((d) => d.today).map((d) => d.day)).toEqual(["tue"])
	})
})

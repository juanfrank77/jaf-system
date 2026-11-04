import { describe, expect, it } from "vitest"
import {
	isPastPayDay,
	isPayDayToday,
	pastPayDayCutoff,
	payDayFor,
} from "./pay-day"

const at = (iso: string) => new Date(iso)

describe("pay day (due day and setting)", () => {
	const sent = at("2026-10-12T16:00:00Z") // Mon

	it("is yellow on the due day and red from the day after", () => {
		expect(isPayDayToday(sent, at("2026-10-15T16:00:00Z"))).toBe(true)
		expect(isPastPayDay(sent, at("2026-10-15T16:00:00Z"))).toBe(false)
		expect(isPayDayToday(sent, at("2026-10-16T16:00:00Z"))).toBe(false)
		expect(isPastPayDay(sent, at("2026-10-16T16:00:00Z"))).toBe(true)
	})

	it("is not yellow before the due day", () => {
		expect(isPayDayToday(sent, at("2026-10-14T16:00:00Z"))).toBe(false)
	})

	it("follows the pay day setting", () => {
		// Friday as the pay day: due Fri 16 Oct, red from Sat 17.
		expect(payDayFor(sent, 5)).toBe("2026-10-16")
		expect(isPastPayDay(sent, at("2026-10-16T16:00:00Z"), 5)).toBe(false)
		expect(isPastPayDay(sent, at("2026-10-17T16:00:00Z"), 5)).toBe(true)
		expect(pastPayDayCutoff(at("2026-10-17T16:00:00Z"), 5).toISOString()).toBe(
			"2026-10-16T04:00:00.000Z",
		)
	})
})

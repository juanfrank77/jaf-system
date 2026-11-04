import { describe, expect, it } from "vitest"
import { isPastPayDay, pastPayDayCutoff, payDayFor } from "./pay-day"

const at = (iso: string) => new Date(iso)

describe("pay day", () => {
	it("is the first Thursday after the request was sent", () => {
		// Mon 12 Oct 2026 -> Thu 15 Oct; Thu 15 Oct itself -> Thu 22 Oct.
		expect(payDayFor(at("2026-10-12T16:00:00Z"))).toBe("2026-10-15")
		expect(payDayFor(at("2026-10-15T16:00:00Z"))).toBe("2026-10-22")
		expect(payDayFor(at("2026-10-16T16:00:00Z"))).toBe("2026-10-22")
	})

	it("counts the day in Puerto Rico, not UTC", () => {
		// 01:00Z on Fri 16 Oct is still Thu 15 Oct evening in Puerto Rico.
		expect(payDayFor(at("2026-10-16T01:00:00Z"))).toBe("2026-10-22")
	})

	it("is past only once the Thursday has gone by", () => {
		const sent = at("2026-10-12T16:00:00Z")
		expect(isPastPayDay(sent, at("2026-10-15T16:00:00Z"))).toBe(false)
		expect(isPastPayDay(sent, at("2026-10-16T16:00:00Z"))).toBe(true)
		// Sent 11 days ago, Fri 23 Oct: flagged.
		expect(isPastPayDay(sent, at("2026-10-23T16:00:00Z"))).toBe(true)
		// Sent today: not flagged.
		expect(
			isPastPayDay(at("2026-10-23T14:00:00Z"), at("2026-10-23T16:00:00Z")),
		).toBe(false)
	})

	it("cutoff agrees with isPastPayDay", () => {
		const now = at("2026-10-23T16:00:00Z")
		const cutoff = pastPayDayCutoff(now)
		for (const iso of [
			"2026-10-12T16:00:00Z",
			"2026-10-21T16:00:00Z",
			"2026-10-22T03:00:00Z",
			"2026-10-22T16:00:00Z",
			"2026-10-23T14:00:00Z",
		]) {
			const sent = at(iso)
			expect(sent < cutoff).toBe(isPastPayDay(sent, now))
		}
	})
})

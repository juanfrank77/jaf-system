import { describe, expect, it } from "vitest"
import {
	isResent,
	isReturned,
	isWithFinance,
	latestReturn,
	markResent,
	returnHistory,
} from "./returned-packet"

const first = {
	note: "Aviso number does not match the PDF",
	byUserId: "lissette",
	createdAt: "2026-10-26T14:00:00.000Z",
}
const second = {
	note: "Pre-cert is missing the crew signature",
	byUserId: "lissette",
	createdAt: "2026-10-27T09:30:00.000Z",
}
const resentAt = new Date("2026-10-27T15:45:00.000Z")
/** Released to Finance, not verified, no LC request: where a return is live. */
const open = {
	releasedToFinanceAt: "2026-10-25T10:00:00.000Z",
	financeVerifiedAt: null,
	pbccRequestSentAt: null,
}

describe("returned packets", () => {
	it("a job never sent back is neither returned nor resent", () => {
		for (const notes of [null, undefined, [], "garbage", 42, { note: "x" }]) {
			const doc = { ...open, financeSendBackNotes: notes }
			expect(latestReturn(doc), String(notes)).toBeNull()
			expect(isReturned(doc)).toBe(false)
			expect(isResent(doc)).toBe(false)
		}
	})

	it("one send-back makes the job returned, with her note", () => {
		const doc = { ...open, financeSendBackNotes: [first] }
		expect(latestReturn(doc)).toEqual(first)
		expect(isReturned(doc)).toBe(true)
		expect(isResent(doc)).toBe(false)
	})

	it("two returns then one resend: the latest note wins, history keeps both", () => {
		const notes = markResent([first, second], resentAt)
		const doc = { ...open, financeSendBackNotes: notes }
		expect(latestReturn(doc)).toEqual({
			...second,
			resentAt: resentAt.toISOString(),
		})
		expect(isReturned(doc)).toBe(false)
		expect(isResent(doc)).toBe(true)
		expect(returnHistory(notes)).toEqual([
			first,
			{ ...second, resentAt: resentAt.toISOString() },
		])
	})

	it("a new return after a resend makes the job returned again", () => {
		const resent = markResent([first], resentAt) as unknown[]
		const doc = { ...open, financeSendBackNotes: [...resent, second] }
		expect(latestReturn(doc)).toEqual(second)
		expect(isReturned(doc)).toBe(true)
		expect(isResent(doc)).toBe(false)
	})

	it("markResent stamps only the latest entry and is idempotent", () => {
		const once = markResent([first, second], resentAt)
		const twice = markResent(once, new Date("2026-10-28T00:00:00.000Z"))
		expect(twice).toEqual(once)
		expect((once as { resentAt?: string }[])[0].resentAt).toBeUndefined()
	})

	it("markResent never mutates its input and leaves garbage alone", () => {
		const input = [first]
		markResent(input, resentAt)
		expect(input).toEqual([first])
		expect(markResent(null, resentAt)).toBeNull()
		expect(markResent("garbage", resentAt)).toBe("garbage")
		expect(markResent([], resentAt)).toEqual([])
	})

	it("skips malformed entries when reading the latest return", () => {
		const doc = { financeSendBackNotes: [first, { note: 3 }, null] }
		expect(latestReturn(doc)).toEqual(first)
		expect(returnHistory(doc.financeSendBackNotes)).toEqual([first])
	})

	describe("legacy entries (no resentAt, written by master before S4)", () => {
		// Master's send_back wrote {note, byUserId, createdAt}; the supervisor
		// fixed the job and Finance verified it, with no resend stamp.
		const legacy = [first]

		it("an unverified released job with a legacy entry is returned", () => {
			const doc = { ...open, financeSendBackNotes: legacy }
			expect(isReturned(doc)).toBe(true)
			expect(isWithFinance(doc)).toBe(false)
		})

		it("a verified job with a legacy entry is not returned", () => {
			const doc = {
				...open,
				financeVerifiedAt: "2026-10-26T18:00:00.000Z",
				financeSendBackNotes: legacy,
			}
			expect(isReturned(doc)).toBe(false)
			expect(isResent(doc)).toBe(false)
			expect(isWithFinance(doc)).toBe(true)
		})

		it("a job with an LC request sent and a legacy entry is not returned", () => {
			const doc = {
				...open,
				pbccRequestSentAt: new Date("2026-10-27T08:00:00.000Z"),
				financeSendBackNotes: legacy,
			}
			expect(isReturned(doc)).toBe(false)
			expect(isWithFinance(doc)).toBe(true)
		})

		it("a job never released is not returned, whatever its notes say", () => {
			const doc = {
				...open,
				releasedToFinanceAt: null,
				financeSendBackNotes: legacy,
			}
			expect(isReturned(doc)).toBe(false)
			expect(isWithFinance(doc)).toBe(false)
		})

		it("a resent packet Finance then verified is no longer 'resent'", () => {
			const doc = {
				...open,
				financeVerifiedAt: "2026-10-28T09:00:00.000Z",
				financeSendBackNotes: markResent([first], resentAt),
			}
			expect(isReturned(doc)).toBe(false)
			expect(isResent(doc)).toBe(false)
		})
	})
})

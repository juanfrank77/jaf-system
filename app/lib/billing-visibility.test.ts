import { describe, expect, it } from "vitest"
import { canSeeBilling, hideBilling } from "./billing-visibility"

const doc = { avisoNumber: "AV-9", advanceAmount: "100", jobType: "FIBER" }

describe("billing visibility", () => {
	it.each(["CREW", "INSTALLER"])("blanks billing fields for %s", (role) => {
		expect(canSeeBilling(role)).toBe(false)
		expect(hideBilling(doc, role)).toMatchObject({
			jobType: "FIBER",
			avisoNumber: null,
			advanceAmount: null,
		})
	})

	it.each(["SUPERVISOR", "FINANCE", "ADMIN", "WAREHOUSE"])(
		"keeps everything for %s",
		(role) => {
			expect(canSeeBilling(role)).toBe(true)
			expect(hideBilling(doc, role)).toBe(doc)
		},
	)
})

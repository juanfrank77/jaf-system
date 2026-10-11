import { describe, expect, it } from "vitest"
import { pbccStep } from "./finance-steps"

describe("pbccStep", () => {
	it("follows the packet through request, funding and list", () => {
		expect(pbccStep({ pbccRequestSentAt: null, advanceReceivedAt: null })).toBe(
			"LC_REQUEST",
		)
		expect(
			pbccStep({ pbccRequestSentAt: new Date(), advanceReceivedAt: null }),
		).toBe("LC_FUNDED")
		expect(
			pbccStep({
				pbccRequestSentAt: new Date(),
				advanceReceivedAt: new Date(),
			}),
		).toBe("LISTS")
	})
})

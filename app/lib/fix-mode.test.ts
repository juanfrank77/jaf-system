import { describe, expect, it } from "vitest"
import { fixModeFor } from "./fix-mode"

const doc = (over = {}) => ({
	status: "SUPERVISOR_APPROVED",
	supervisorApprovedAt: new Date(),
	jafInvoiceGeneratedAt: null,
	releasedToFinanceAt: null,
	...over,
})

describe("fixModeFor", () => {
	it("lets the supervisor reopen a signed job that was not sent", () => {
		expect(fixModeFor(doc(), "SUPERVISOR")).toBe("reopen")
		expect(fixModeFor(doc(), "ADMIN")).toBe("reopen")
	})

	it("only lets a supervisor ask an administrator once the packet was sent", () => {
		const sent = doc({ jafInvoiceGeneratedAt: new Date() })
		expect(fixModeFor(sent, "SUPERVISOR")).toBe("request")
		expect(fixModeFor(sent, "ADMIN")).toBeNull()
	})

	it("treats a released job the same way", () => {
		const released = doc({
			jafInvoiceGeneratedAt: new Date(),
			releasedToFinanceAt: new Date(),
		})
		expect(fixModeFor(released, "SUPERVISOR")).toBe("request")
	})

	it("is nothing before sign-off, and nothing on a cancelled job", () => {
		expect(
			fixModeFor(
				doc({ supervisorApprovedAt: null, status: "FIELD_UPDATED" }),
				"SUPERVISOR",
			),
		).toBeNull()
		expect(fixModeFor(doc({ status: "CANCELLED" }), "SUPERVISOR")).toBeNull()
	})
})

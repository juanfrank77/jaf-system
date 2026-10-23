import { describe, expect, it } from "vitest"
import en from "../../resources/locales/en/common.json"
import es from "../../resources/locales/es/common.json"
import { armAStepOf, pbccStep, stepNumber } from "./finance-steps"

describe("step names", () => {
	it.each([
		["en", en],
		["es", es],
	])("%s: rail step names equal the sidebar labels", (_l, c) => {
		const step = c.finance_flow.step
		const nav = c.app_shell.nav
		expect(step.packets).toBe(nav.finance_packets)
		expect(step.lc_request).toBe(nav.finance_lc_request)
		expect(step.lists).toBe(nav.finance_lists)
	})
})

describe("pbccStep", () => {
	it("is the batch until the packet is sold to PBCC, then Payroll to Carmen", () => {
		expect(pbccStep({ pbccRequestSentAt: null })).toBe("LC_REQUEST")
		expect(pbccStep({ pbccRequestSentAt: new Date() })).toBe("LISTS")
	})
})

describe("stepNumber", () => {
	it("is the 1-based rail position", () => {
		expect(stepNumber("PACKETS")).toBe(1)
		expect(stepNumber("LC_REQUEST")).toBe(2)
		expect(stepNumber("LISTS")).toBe(3)
	})
})

describe("armAStepOf", () => {
	const none = { financeVerifiedAt: null, pbccRequestSentAt: null }
	const at = new Date()

	it("puts a job nobody has accepted in the Inbox", () => {
		expect(armAStepOf(none)).toBe("PACKETS")
	})
	it("moves an accepted, unsold job to the PBCC batch", () => {
		expect(armAStepOf({ ...none, financeVerifiedAt: at })).toBe("LC_REQUEST")
	})
	it("moves a sold job to Payroll to Carmen, funded or not", () => {
		expect(armAStepOf({ financeVerifiedAt: at, pbccRequestSentAt: at })).toBe(
			"LISTS",
		)
	})
	it("tests the sold date first, like the Inbox filter", () => {
		expect(armAStepOf({ ...none, pbccRequestSentAt: at })).toBe("LISTS")
	})
})

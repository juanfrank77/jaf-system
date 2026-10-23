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
		expect(step.lc_funded).toBe(nav.finance_lc_funded)
		expect(step.lists).toBe(nav.finance_lists)
		expect(step.carmen).toBe(nav.finance_carmen)
	})
})

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

describe("stepNumber", () => {
	it("is the 1-based rail position", () => {
		expect(stepNumber("PACKETS")).toBe(1)
		expect(stepNumber("LC_REQUEST")).toBe(2)
		expect(stepNumber("LC_FUNDED")).toBe(3)
		expect(stepNumber("LISTS")).toBe(4)
		expect(stepNumber("CARMEN")).toBe(5)
	})
})

describe("armAStepOf", () => {
	const none = {
		financeVerifiedAt: null,
		pbccRequestSentAt: null,
		advanceReceivedAt: null,
	}
	const at = new Date()

	it("puts a job nobody has accepted in the Inbox", () => {
		expect(armAStepOf(none)).toBe("PACKETS")
	})
	it("moves an accepted, unsent job to the PBCC batch", () => {
		expect(armAStepOf({ ...none, financeVerifiedAt: at })).toBe("LC_REQUEST")
	})
	it("moves a sent, unfunded job to LC funded", () => {
		expect(
			armAStepOf({ ...none, financeVerifiedAt: at, pbccRequestSentAt: at }),
		).toBe("LC_FUNDED")
	})
	it("moves a sent and funded job to Lists", () => {
		expect(
			armAStepOf({
				financeVerifiedAt: at,
				pbccRequestSentAt: at,
				advanceReceivedAt: at,
			}),
		).toBe("LISTS")
	})
	it("tests the sent date first, like the Packets-in filter", () => {
		expect(armAStepOf({ ...none, pbccRequestSentAt: at })).toBe("LC_FUNDED")
	})
})

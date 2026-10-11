import { describe, expect, it } from "vitest"
import en from "../../resources/locales/en/common.json"
import es from "../../resources/locales/es/common.json"
import { pbccStep, stepNumber } from "./finance-steps"

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

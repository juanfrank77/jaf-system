import { describe, expect, it } from "vitest"
import { claroStepOf } from "./claro-steps"

const d = new Date()
describe("claroStepOf", () => {
	it.each([
		["PENDING", null, 1],
		["READING", null, 1],
		["READY", null, 2],
		["NEEDS_LOOK", null, 2],
		["BLOCKED", null, 2],
		["UNMATCHED", null, 2],
		["CONFIRMED", null, 3],
		["CONFIRMED", { loadedAt: null, paidAt: null }, 4],
		["CONFIRMED", { loadedAt: d, paidAt: null }, 5],
		["CONFIRMED", { loadedAt: d, paidAt: d }, 5],
	] as const)("%s %j -> %i", (status, invoice, step) => {
		expect(claroStepOf({ status, invoice })).toBe(step)
	})
})

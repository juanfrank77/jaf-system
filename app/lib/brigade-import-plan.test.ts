import { describe, expect, it } from "vitest"
import type { BrigadeImportRow } from "./brigade-import"
import { normalizeBrigadeName, planBrigadeImport } from "./brigade-import-plan"

const row = (
	code: string,
	name: string,
	extra: Partial<BrigadeImportRow> = {},
): BrigadeImportRow => ({
	code,
	name,
	baseCode: null,
	isEquipmentAccount: false,
	status: "ACTIVE",
	typeHint: null,
	checkWithLissette: null,
	...extra,
})

describe("normalizeBrigadeName", () => {
	it("strips accents, punctuation and initials, unifies abbreviations", () => {
		expect(normalizeBrigadeName("Samuel González")).toBe("SAMUEL GONZALEZ")
		expect(normalizeBrigadeName("SAMUEL A. GONZALEZ")).toBe("SAMUEL GONZALEZ")
		expect(normalizeBrigadeName("IR COMM & CONSTRUCTION")).toBe(
			normalizeBrigadeName("IR COMMUNICATION & CONSTRUCTION"),
		)
		expect(normalizeBrigadeName("Acme Contruction LLC")).toBe(
			normalizeBrigadeName("ACME CONST INC"),
		)
	})
})

describe("planBrigadeImport", () => {
	it("is a no-op when the existing code equals a CSV code", () => {
		const plan = planBrigadeImport(
			[row("025", "ALEXIS DIAZ SIERRA")],
			[{ id: "b1", name: "ALEXIS DIAZ", code: "025" }],
		)
		expect(plan.recodes).toEqual([])
		expect(plan.creates).toEqual([])
		expect(plan.suggestions).toEqual([])
	})

	it("recodes on an exact normalized name match", () => {
		const plan = planBrigadeImport(
			[row("151", "IR COMM & CONSTRUCTION"), row("159", "SAMUEL A. GONZALEZ")],
			[
				{ id: "ir", name: "IR COMMUNICATION & CONSTRUCTION", code: "256" },
				{ id: "sg", name: "Samuel González", code: "261" },
			],
		)
		expect(plan.recodes).toEqual([
			{ brigadeId: "ir", from: "256", to: "151", confidence: "name" },
			{ brigadeId: "sg", from: "261", to: "159", confidence: "name" },
		])
		expect(plan.creates).toEqual([])
	})

	it("only suggests close names and still creates the row", () => {
		const plan = planBrigadeImport(
			[row("025", "ALEXIS DIAZ SIERRA")],
			[{ id: "b1", name: "ALEXIS DIAZ", code: "300" }],
		)
		expect(plan.recodes).toEqual([])
		expect(plan.suggestions).toEqual([
			{ brigadeId: "b1", csvCode: "025", confidence: "close" },
		])
		expect(plan.creates.map((r) => r.code)).toEqual(["025"])
	})

	it("does not match look-alike names", () => {
		const plan = planBrigadeImport(
			[row("1", "RF COMMUNICATION"), row("2", "IVAN VAZQUEZ")],
			[
				{ id: "ir", name: "IR COMMUNICATION", code: "256" },
				{ id: "jv", name: "JUAN VAZQUEZ", code: "300" },
			],
		)
		expect(plan.recodes).toEqual([])
		expect(plan.suggestions).toEqual([])
	})

	it("keeps two codes for one name as two creates", () => {
		const plan = planBrigadeImport(
			[row("040", "DANIEL PIZA"), row("067", "DANIEL PIZA")],
			[],
		)
		expect(plan.creates.map((r) => r.code)).toEqual(["040", "067"])
	})

	it("suggests each of several same-name rows instead of picking one", () => {
		const rows = [row("040", "DANIEL PIZA"), row("067", "DANIEL PIZA")]
		const existing = [{ id: "dp", name: "Daniel Piza", code: "250" }]
		const plan = planBrigadeImport(rows, existing)
		expect(plan.recodes).toEqual([])
		expect(plan.suggestions).toEqual([
			{ brigadeId: "dp", csvCode: "040", confidence: "close" },
			{ brigadeId: "dp", csvCode: "067", confidence: "close" },
		])
		expect(plan.creates.map((r) => r.code)).toEqual(["040", "067"])

		const chosen = planBrigadeImport(rows, existing, { dp: "067" })
		expect(chosen.recodes).toEqual([
			{ brigadeId: "dp", from: "250", to: "067", confidence: "manual" },
		])
		expect(chosen.creates.map((r) => r.code)).toEqual(["040"])
		expect(chosen.suggestions).toEqual([])
	})

	it("conflicting initials do not recode; a missing initial still does", () => {
		const conflict = planBrigadeImport(
			[row("1", "JUAN M VAZQUEZ")],
			[{ id: "j", name: "JUAN A VAZQUEZ", code: "300" }],
		)
		expect(conflict.recodes).toEqual([])
		expect(conflict.creates.map((r) => r.code)).toEqual(["1"])

		const missing = planBrigadeImport(
			[row("159", "SAMUEL A. GONZALEZ")],
			[{ id: "s", name: "SAMUEL GONZALEZ", code: "261" }],
		)
		expect(missing.recodes).toEqual([
			{ brigadeId: "s", from: "261", to: "159", confidence: "name" },
		])
		const same = planBrigadeImport(
			[row("159", "SAMUEL A. GONZALEZ")],
			[{ id: "s", name: "Samuel A Gonzalez", code: "261" }],
		)
		expect(same.recodes).toHaveLength(1)
	})

	it("a single-word name never auto-recodes", () => {
		const plan = planBrigadeImport(
			[row("1", "MARIA L")],
			[{ id: "m", name: "MARIA J", code: "300" }],
		)
		expect(plan.recodes).toEqual([])
		const bare = planBrigadeImport(
			[row("2", "MARIA")],
			[{ id: "m", name: "MARIA", code: "300" }],
		)
		expect(bare.recodes).toEqual([])
	})

	it("lists overrides it cannot honour", () => {
		const rows = [row("A", "ONE X"), row("B", "TWO Y"), row("C", "THREE Z")]
		const existing = [
			{ id: "r1", name: "HAS CODE", code: "A" },
			{ id: "p", name: "P P", code: "10" },
			{ id: "q", name: "Q Q", code: "11" },
			{ id: "n", name: "N N", code: "12" },
		]
		const plan = planBrigadeImport(rows, existing, {
			p: "A", // claimed by rule 1
			q: "B",
			n: "B", // second override to B
			ghost: "C", // unknown brigade
			r1: "C", // brigade already matched by its code
		})
		expect(plan.recodes).toEqual([
			{ brigadeId: "q", from: "11", to: "B", confidence: "manual" },
		])
		expect(plan.ignoredOverrides).toEqual(
			expect.arrayContaining([
				{ brigadeId: "ghost", code: "C", reason: "unknown_brigade" },
				{ brigadeId: "r1", code: "C", reason: "brigade_matched_by_code" },
				{ brigadeId: "p", code: "A", reason: "code_claimed" },
				{ brigadeId: "n", code: "B", reason: "code_claimed" },
			]),
		)
		expect(plan.ignoredOverrides).toHaveLength(4)

		const missing = planBrigadeImport(rows, existing, { p: "ZZZ" })
		expect(missing.ignoredOverrides).toEqual([
			{ brigadeId: "p", code: "ZZZ", reason: "code_not_in_file" },
		])
	})

	it("an override applies a suggestion and claims the code", () => {
		const plan = planBrigadeImport(
			[row("025", "ALEXIS DIAZ SIERRA")],
			[{ id: "b1", name: "ALEXIS DIAZ", code: "300" }],
			{ b1: "025" },
		)
		expect(plan.recodes).toEqual([
			{ brigadeId: "b1", from: "300", to: "025", confidence: "manual" },
		])
		expect(plan.creates).toEqual([])
		expect(plan.suggestions).toEqual([])
	})

	it('an override of "" leaves the brigade alone, even on a name match', () => {
		const plan = planBrigadeImport(
			[row("151", "IR COMM & CONSTRUCTION")],
			[{ id: "ir", name: "IR COMMUNICATION & CONSTRUCTION", code: "256" }],
			{ ir: "" },
		)
		expect(plan.recodes).toEqual([])
		expect(plan.suggestions).toEqual([])
		expect(plan.creates.map((r) => r.code)).toEqual(["151"])
	})

	it("creates equipment rows with baseCode kept", () => {
		const plan = planBrigadeImport(
			[
				row("126D", "ALEXANDER ARCE", {
					baseCode: "126",
					isEquipmentAccount: true,
				}),
			],
			[{ id: "aa", name: "ALEXANDER ARCE", code: "126" }],
		)
		expect(plan.recodes).toEqual([])
		expect(plan.creates).toEqual([
			expect.objectContaining({
				code: "126D",
				isEquipmentAccount: true,
				baseCode: "126",
			}),
		])
	})

	it("flags warned and Lissette-check rows, and drops repeated codes", () => {
		const plan = planBrigadeImport(
			[
				row("7", "A B", { warning: "numeric_code" }),
				row("8", "C D", { checkWithLissette: "confirm" }),
				row("8", "C D again"),
			],
			[],
		)
		expect(plan.flagged.map((r) => r.code)).toEqual(["7", "8"])
		expect(plan.creates.map((r) => r.code)).toEqual(["7", "8"])
		expect(plan.skipped).toContainEqual({
			code: "8",
			reason: "duplicate_code_in_file",
		})
	})

	it("is stable: re-planning after applying changes nothing", () => {
		const rows = [row("151", "IR COMM & CONSTRUCTION"), row("500", "NEW ONE")]
		const first = planBrigadeImport(rows, [
			{ id: "ir", name: "IR COMMUNICATION & CONSTRUCTION", code: "256" },
		])
		const after = [
			{ id: "ir", name: "IR COMMUNICATION & CONSTRUCTION", code: "151" },
			{ id: "new", name: "NEW ONE", code: "500" },
		]
		expect(first.recodes).toHaveLength(1)
		const second = planBrigadeImport(rows, after)
		expect(second.recodes).toEqual([])
		expect(second.creates).toEqual([])
	})
})

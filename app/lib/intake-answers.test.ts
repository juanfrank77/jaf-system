import { describe, expect, it } from "vitest"
import { parseIntakeAnswers } from "./intake-answers"

function form(entries: Record<string, string>) {
	const f = new FormData()
	for (const [k, v] of Object.entries(entries)) f.set(k, v)
	return f
}

describe("parseIntakeAnswers", () => {
	it("requires the materials-source choice", () => {
		expect(parseIntakeAnswers(form({ prefieldNeeded: "needed" }))).toEqual({
			ok: false,
			errorKey: "docs_new.errors.materials_choice_required",
		})
	})

	it("requires a reason when materials do not come from the warehouse", () => {
		for (const reason of ["", "   "]) {
			expect(
				parseIntakeAnswers(
					form({
						materialsFromWarehouse: "no",
						materialsReason: reason,
						prefieldNeeded: "needed",
					}),
				),
			).toEqual({
				ok: false,
				errorKey: "docs_new.errors.materials_reason_required",
			})
		}
		expect(
			parseIntakeAnswers(
				form({ materialsFromWarehouse: "no", prefieldNeeded: "needed" }),
			),
		).toEqual({
			ok: false,
			errorKey: "docs_new.errors.materials_reason_required",
		})
	})

	it("requires the prefield choice", () => {
		expect(parseIntakeAnswers(form({ materialsFromWarehouse: "yes" }))).toEqual(
			{ ok: false, errorKey: "docs_new.errors.prefield_choice_required" },
		)
	})

	it("reads yes + needed", () => {
		expect(
			parseIntakeAnswers(
				form({ materialsFromWarehouse: "yes", prefieldNeeded: "needed" }),
			),
		).toEqual({
			ok: true,
			value: {
				materialsFromWarehouse: true,
				materialsReason: null,
				prefieldNeeded: true,
			},
		})
	})

	it("trims the reason on no", () => {
		expect(
			parseIntakeAnswers(
				form({
					materialsFromWarehouse: "no",
					materialsReason: "  own truck ",
					prefieldNeeded: "not_needed",
				}),
			),
		).toEqual({
			ok: true,
			value: {
				materialsFromWarehouse: false,
				materialsReason: "own truck",
				prefieldNeeded: false,
			},
		})
	})

	it("drops a reason sent with yes", () => {
		expect(
			parseIntakeAnswers(
				form({
					materialsFromWarehouse: "yes",
					materialsReason: "own truck",
					prefieldNeeded: "not_needed",
				}),
			),
		).toEqual({
			ok: true,
			value: {
				materialsFromWarehouse: true,
				materialsReason: null,
				prefieldNeeded: false,
			},
		})
	})
})

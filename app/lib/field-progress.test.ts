import { describe, expect, it } from "vitest"
import { blockingMissing, fieldTargets, nextEmpty } from "./field-progress"

const base = {
	actuals: [
		{ id: "a1", value: "" },
		{ id: "a2", value: "3" },
		{ id: "a3", value: "" },
	],
	notes: "N/A",
	beforePhotos: 1,
	afterPhotos: 1,
}

describe("field progress", () => {
	it("walks the empty boxes in page order, wrapping at the end", () => {
		const t = fieldTargets(base)
		expect(nextEmpty(t)?.id).toBe("a1")
		expect(nextEmpty(t, "a1")?.id).toBe("a3")
		expect(nextEmpty(t, "a3")?.id).toBe("a1")
	})

	it("returns nothing once every box is filled", () => {
		const t = fieldTargets({
			...base,
			actuals: [{ id: "a1", value: "0" }],
		})
		expect(nextEmpty(t)).toBeUndefined()
	})

	it("blocks Continue on the report and the photos, never on Actual", () => {
		expect(blockingMissing(fieldTargets(base))).toEqual([])
		const missing = blockingMissing(
			fieldTargets({ ...base, notes: "  ", beforePhotos: 0 }),
		)
		expect(missing.map((m) => m.kind)).toEqual(["notes", "before"])
	})

	it("counts 0 as a filled Actual", () => {
		const t = fieldTargets({ ...base, actuals: [{ id: "a1", value: "0" }] })
		expect(t[0].empty).toBe(false)
	})
})

import { describe, expect, it } from "vitest"
import { paginate } from "./pagination"

describe("paginate", () => {
	it("starts at page 1 with no request", () => {
		expect(paginate(undefined, 40, 15)).toEqual({
			page: 1,
			pageCount: 3,
			skip: 0,
			take: 15,
		})
	})

	it("skips the earlier pages", () => {
		expect(paginate("2", 40, 15)).toMatchObject({ page: 2, skip: 15 })
	})

	it("clamps a page past the end to the last one", () => {
		expect(paginate("99", 40, 15)).toMatchObject({ page: 3, skip: 30 })
	})

	it("falls back to page 1 for junk input", () => {
		for (const bad of ["0", "-2", "abc", "1.5", null]) {
			expect(paginate(bad, 40, 15).page).toBe(1)
		}
	})

	it("has one page when the list is empty", () => {
		expect(paginate("3", 0, 15)).toMatchObject({ page: 1, pageCount: 1 })
	})
})

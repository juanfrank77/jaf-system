import { describe, expect, it } from "vitest"
import { clearFiltersHref } from "./dashboard-filters"

describe("clearFiltersHref", () => {
	it("keeps the stage param when clearing filters", () => {
		expect(clearFiltersHref("/dashboard", "?stage=all&status=CREATED")).toBe(
			"/dashboard?stage=all",
		)
	})

	it("drops to the plain path when there is no stage", () => {
		expect(clearFiltersHref("/dashboard", "?status=CREATED")).toBe("/dashboard")
	})
})

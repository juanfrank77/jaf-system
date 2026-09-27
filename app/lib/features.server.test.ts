import { afterEach, describe, expect, it } from "vitest"
import { isDashboardFiltersEnabled } from "./features.server"

afterEach(() => {
	delete process.env.ENABLE_DASHBOARD_FILTERS
})

describe("isDashboardFiltersEnabled", () => {
	it("is on when the flag is unset (default-on for Phase 3)", () => {
		expect(isDashboardFiltersEnabled()).toBe(true)
	})
	it("is off only when explicitly disabled", () => {
		process.env.ENABLE_DASHBOARD_FILTERS = "false"
		expect(isDashboardFiltersEnabled()).toBe(false)
	})
})

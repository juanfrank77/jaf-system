import { describe, expect, it } from "vitest"
import {
	nextTheme,
	parseTheme,
	resolveTheme,
	THEME_STORAGE_KEY,
	themeInitScript,
} from "./theme"

describe("theme", () => {
	it("parses valid values and falls back to system for anything else", () => {
		expect(parseTheme("dark")).toBe("dark")
		expect(parseTheme("light")).toBe("light")
		expect(parseTheme("system")).toBe("system")
		expect(parseTheme("purple")).toBe("system")
		expect(parseTheme(null)).toBe("system")
		expect(parseTheme(undefined)).toBe("system")
		expect(parseTheme(42)).toBe("system")
	})

	it("resolves system from the OS preference", () => {
		expect(resolveTheme("system", true)).toBe("dark")
		expect(resolveTheme("system", false)).toBe("light")
		expect(resolveTheme("dark", false)).toBe("dark")
		expect(resolveTheme("light", true)).toBe("light")
	})

	it("cycles system → light → dark → system", () => {
		expect(nextTheme("system")).toBe("light")
		expect(nextTheme("light")).toBe("dark")
		expect(nextTheme("dark")).toBe("system")
	})

	it("init script reads the storage key", () => {
		expect(themeInitScript).toContain(THEME_STORAGE_KEY)
	})
})

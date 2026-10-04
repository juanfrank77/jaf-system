import { describe, expect, it } from "vitest"
import {
	nextTheme,
	parseTheme,
	THEME_STORAGE_KEY,
	themeInitScript,
} from "./theme"

describe("theme", () => {
	it("parses only the exact string dark as dark; everything else is light", () => {
		expect(parseTheme("dark")).toBe("dark")
		expect(parseTheme("light")).toBe("light")
		expect(parseTheme("system")).toBe("light")
		expect(parseTheme("purple")).toBe("light")
		expect(parseTheme(null)).toBe("light")
		expect(parseTheme(undefined)).toBe("light")
		expect(parseTheme(42)).toBe("light")
	})

	it("toggles light <-> dark", () => {
		expect(nextTheme("light")).toBe("dark")
		expect(nextTheme("dark")).toBe("light")
	})

	it("init script reads the storage key and never consults the OS", () => {
		expect(themeInitScript).toContain(THEME_STORAGE_KEY)
		expect(themeInitScript).not.toContain("matchMedia")
	})
})

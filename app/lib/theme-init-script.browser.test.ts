import { afterEach, describe, expect, it } from "vitest"
import { THEME_STORAGE_KEY, themeInitScript } from "./theme"

function run() {
	new Function(themeInitScript)()
}

describe("themeInitScript", () => {
	afterEach(() => {
		document.documentElement.classList.remove("dark")
		window.localStorage.removeItem(THEME_STORAGE_KEY)
	})

	it("adds the dark class for a stored dark preference", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark")
		run()
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})

	it("removes the dark class for a stored light preference", () => {
		document.documentElement.classList.add("dark")
		window.localStorage.setItem(THEME_STORAGE_KEY, "light")
		run()
		expect(document.documentElement.classList.contains("dark")).toBe(false)
	})

	it("follows the OS for a garbage stored value", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "purple")
		run()
		expect(document.documentElement.classList.contains("dark")).toBe(
			window.matchMedia("(prefers-color-scheme: dark)").matches,
		)
	})
})

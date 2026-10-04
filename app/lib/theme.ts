export type ThemePreference = "light" | "dark"

export const THEME_STORAGE_KEY = "jaf-theme"

export function parseTheme(value: unknown): ThemePreference {
	return value === "dark" ? "dark" : "light"
}

export function nextTheme(preference: ThemePreference): ThemePreference {
	return preference === "dark" ? "light" : "dark"
}

export function readStoredTheme(): ThemePreference {
	try {
		return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
	} catch {
		return "light"
	}
}

export function writeStoredTheme(preference: ThemePreference): void {
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, preference)
	} catch {
		// Storage can be blocked (private windows); the theme still applies
		// for this session.
	}
}

export function applyTheme(preference: ThemePreference): void {
	document.documentElement.classList.toggle("dark", preference === "dark")
}

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{document.documentElement.classList.toggle("dark",localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")}catch(e){}})()`

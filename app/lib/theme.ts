export type ThemePreference = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "jaf-theme"

export function parseTheme(value: unknown): ThemePreference {
	return value === "light" || value === "dark" || value === "system"
		? value
		: "system"
}

export function resolveTheme(
	preference: ThemePreference,
	systemDark: boolean,
): "light" | "dark" {
	if (preference === "system") return systemDark ? "dark" : "light"
	return preference
}

export function nextTheme(preference: ThemePreference): ThemePreference {
	if (preference === "system") return "light"
	if (preference === "light") return "dark"
	return "system"
}

export function readStoredTheme(): ThemePreference {
	try {
		return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
	} catch {
		return "system"
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
	const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
	document.documentElement.classList.toggle(
		"dark",
		resolveTheme(preference, systemDark) === "dark",
	)
}

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

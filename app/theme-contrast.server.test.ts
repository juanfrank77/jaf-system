import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.resolve(import.meta.dirname, "app.css"), "utf8")

function block(selector: RegExp): Record<string, string> {
	const m = css.match(selector)
	if (!m) throw new Error(`block not found: ${selector}`)
	const vars: Record<string, string> = {}
	for (const v of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
		vars[v[1]] = v[2]
	}
	return vars
}

function luminance(hex: string) {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

// [foreground token, background token]
const TEXT_PAIRS: [string, string][] = [
	["foreground", "background"],
	["card-foreground", "card"],
	["muted-foreground", "background"],
	["muted-foreground", "card"],
	["muted-foreground", "muted"],
	["secondary-foreground", "secondary"],
	["primary-foreground", "primary"],
	["accent-text", "background"],
	["accent-text", "card"],
	["sidebar-foreground", "sidebar"],
	["sidebar-primary-foreground", "sidebar-primary"],
	["destructive", "background"],
	["status-info", "status-info-soft"],
	["status-warn", "status-warn-soft"],
	["status-danger", "status-danger-soft"],
	["status-ok", "status-ok-soft"],
	["status-danger-solid-foreground", "status-danger-solid"],
]

describe.each([
	["light", /:root\s*\{([^}]*)\}/],
	["dark", /\.dark\s*\{([^}]*)\}/],
])("%s theme contrast", (_name, selector) => {
	const vars = block(selector)
	it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
		expect(vars[fg], `--${fg} missing or not a 6-digit hex`).toBeDefined()
		expect(vars[bg], `--${bg} missing or not a 6-digit hex`).toBeDefined()
		expect(ratio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5)
	})
})

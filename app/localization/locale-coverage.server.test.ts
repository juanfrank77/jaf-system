import fs from "node:fs"
import path from "node:path"
import en from "../../resources/locales/en/common.json"
import es from "../../resources/locales/es/common.json"

const ROUTES_DIR = path.resolve(import.meta.dirname, "../routes")

// Namespaced-only, on purpose: this codebase's convention is that every real
// i18n key is dotted (e.g. "installer.completion.submit"). A bare `t("hi")`
// call doesn't occur in these route files, so requiring a dot avoids false
// positives from unrelated string literals that happen to precede a `t(`
// call for some other identifier (e.g. `.set("x", ...)`).
const T_CALL = /(?<![\w.])t\(\s*["']([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)["']/g

function flatten(obj: unknown, prefix = ""): Set<string> {
	const keys = new Set<string>()
	if (typeof obj !== "object" || obj === null) return keys
	for (const [k, v] of Object.entries(obj)) {
		const full = prefix ? `${prefix}.${k}` : k
		if (typeof v === "object" && v !== null) {
			for (const nested of flatten(v, full)) keys.add(nested)
		} else {
			keys.add(full)
		}
	}
	return keys
}

function keysUsedIn(prefixes: string[]): Map<string, string> {
	const used = new Map<string, string>()
	for (const filename of fs.readdirSync(ROUTES_DIR)) {
		if (!prefixes.some((p) => filename.startsWith(p))) continue
		if (filename.includes(".test.")) continue
		if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) continue
		const content = fs.readFileSync(path.join(ROUTES_DIR, filename), "utf8")
		for (const match of content.matchAll(T_CALL)) {
			used.set(match[1], filename)
		}
	}
	return used
}

const enKeys = flatten(en)
const esKeys = flatten(es)

// i18next plurals: t("x", { count }) resolves to "x_one" / "x_other".
function has(keys: Set<string>, key: string): boolean {
	return keys.has(key) || keys.has(`${key}_other`) || keys.has(`${key}_one`)
}

// Covers the Phase-1 installer/warehouse/restock surface — the screens that
// went in without es coverage the first time (48 keys, silently falling
// back to the hardcoded English default for es-locale users).
const used = keysUsedIn([
	"_app.installer",
	"_app.warehouse",
	"_app.restock",
	"_app.finance",
])

it("every translation key used by the installer/warehouse/restock/finance routes exists in the English locale", () => {
	const missing = [...used.entries()].filter(([key]) => !has(enKeys, key))
	expect(missing).toEqual([])
})

it("every translation key used by the installer/warehouse/restock/finance routes exists in the Spanish locale", () => {
	const missing = [...used.entries()].filter(([key]) => !has(esKeys, key))
	expect(missing).toEqual([])
})

it("has en and es copy for the Finance sidebar", () => {
	for (const k of [
		"app_shell.nav.finance_packets",
		"app_shell.nav.finance_lc_request",
		"app_shell.nav.finance_lc_funded",
		"app_shell.nav.finance_lists",
		"app_shell.nav.finance_carmen",
		"app_shell.nav.finance_awaiting_po",
		"app_shell.nav.finance_awaiting_ariba",
		"app_shell.nav.soon",
		"app_shell.group.arm_a",
		"app_shell.group.arm_b",
	]) {
		expect(enKeys.has(k), `en missing ${k}`).toBe(true)
		expect(esKeys.has(k), `es missing ${k}`).toBe(true)
	}
})

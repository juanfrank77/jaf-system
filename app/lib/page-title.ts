import type { ParseKeys } from "i18next"
import { resources } from "~/localization/resource"

type MetaMatch = { id: string; data?: unknown } | undefined

/**
 * Localized `<title>` for route `meta` exports, which run outside React and so
 * cannot use `useTranslation`. The language comes from the root loader's
 * `{ lang }` (same cookie detection as the rest of the app); an unknown
 * language falls back to English.
 */
export function pageTitle(
	matches: readonly MetaMatch[],
	key?: ParseKeys,
	prefix?: string,
) {
	const root = matches.find((m) => m?.id === "root")?.data as
		| { lang?: string }
		| undefined
	const lang = root?.lang === "es" ? "es" : "en"
	const dict = resources[lang].common as unknown as Record<string, unknown>
	if (!key) return "JAF Ops"
	const label = key
		.split(".")
		.reduce<unknown>(
			(o, k) => (o as Record<string, unknown> | undefined)?.[k],
			dict,
		)
	const text = typeof label === "string" ? label : key
	return `${prefix ? `${prefix} — ` : ""}${text} — JAF Ops`
}

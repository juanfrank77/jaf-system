import type { InitOptions } from "i18next"
import { supportedLanguages } from "./resource"

export default {
	supportedLngs: supportedLanguages,
	fallbackLng: "en",
	defaultNS: "common",
	// React already escapes text nodes; i18next's own HTML-escaping would render
	// a date like 10/5/2026 as "10&#x2F;5&#x2F;2026" and a control number "A/1"
	// as "A&#x2F;1" on every screen.
	interpolation: { escapeValue: false },
} satisfies Omit<InitOptions, "react" | "detection">

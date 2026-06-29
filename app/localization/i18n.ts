import type { InitOptions } from "i18next"
import { supportedLanguages } from "./resource"

export default {
	supportedLngs: supportedLanguages,
	fallbackLng: "en",
	defaultNS: "common",
} satisfies Omit<InitOptions, "react" | "detection">

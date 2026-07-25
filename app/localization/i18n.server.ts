import { createCookie } from "react-router"
import { RemixI18Next } from "remix-i18next/server"
import i18n from "./i18n"
import { resources } from "./resource"

export const lngCookie = createCookie("lng", {
	path: "/",
	sameSite: "lax",
	maxAge: 34_560_000,
})

const i18next = new RemixI18Next({
	detection: {
		supportedLanguages: i18n.supportedLngs,
		fallbackLanguage: i18n.fallbackLng,
		cookie: lngCookie,
	},
	i18next: {
		...i18n,
		resources,
	},
})

export default i18next

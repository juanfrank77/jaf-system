import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"
import i18nConfig from "./i18n"

describe("shared i18n config", () => {
	it("does not HTML-escape interpolated values (dates and control numbers keep their slashes)", async () => {
		const i18n = createInstance()
		await i18n.init({
			...i18nConfig,
			lng: "en",
			resources: { en: { common: { invoiced: "Invoiced {{date}}" } } },
		})
		expect(i18n.t("invoiced" as never, { date: "10/5/2026" })).toBe(
			"Invoiced 10/5/2026",
		)
	})
})

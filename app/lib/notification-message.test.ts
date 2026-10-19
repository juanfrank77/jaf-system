import i18next from "i18next"
import { beforeAll, describe, expect, it } from "vitest"
import { resources } from "~/localization/resource"
import { localizeNotification } from "./notification-message"

describe("localizeNotification", () => {
	beforeAll(async () => {
		await i18next.init({
			lng: "es",
			fallbackLng: "en",
			defaultNS: "common",
			resources,
		})
	})

	it("translates known warehouse messages and keeps interpolated values", () => {
		const t = i18next.t.bind(i18next)
		expect(
			localizeNotification(
				"Job A/12 is prepped and ready for pickup. Please sign at warehouse.",
				t,
			),
		).toBe(
			"El trabajo A/12 está preparado y listo para recoger. Por favor firme en el almacén.",
		)
		expect(localizeNotification("Repair batch b1 sent (3 units).", t)).toBe(
			"Lote de reparación b1 enviado (3 unidades).",
		)
	})

	it("localizes the supervisor ready-for-pickup alert in EN and ES", async () => {
		const msg = "Job A/12 is ready for pickup."
		const en = i18next.getFixedT("en")
		const es = i18next.getFixedT("es")
		expect(localizeNotification(msg, en)).toBe("Job A/12 is ready for pickup.")
		expect(localizeNotification(msg, es)).toBe(
			"El trabajo A/12 está listo para recoger.",
		)
	})

	it("passes unknown messages through unchanged", () => {
		const t = i18next.t.bind(i18next)
		expect(localizeNotification("Something else happened.", t)).toBe(
			"Something else happened.",
		)
	})
})

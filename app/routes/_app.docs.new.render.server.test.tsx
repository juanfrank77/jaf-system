import { createInstance } from "i18next"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))

import NewDoc from "./_app.docs.new"

describe("New work order form (render)", () => {
	it("renders an optional Aviso # input named avisoNumber in the Prefield group", async () => {
		const i18n = createInstance()
		await i18n.use(initReactI18next).init({
			lng: "en",
			ns: "common",
			defaultNS: "common",
			resources,
		})
		const Stub = createRoutesStub([
			{
				path: "/",
				Component: () => (
					<NewDoc
						{...({
							loaderData: {
								serviceCodes: [],
								showPrices: false,
								brigades: [],
								claroSupervisors: [],
								suggestions: { tipo: [], tipoPlanta: [], grupoPlan: [] },
							},
							actionData: undefined,
						} as any)}
					/>
				),
			},
		])
		const html = renderToString(
			<I18nextProvider i18n={i18n}>
				<Stub />
			</I18nextProvider>,
		)
		const input = html.match(/<input[^>]*name="avisoNumber"[^>]*>/)
		expect(input).not.toBeNull()
		expect(input?.[0]).not.toMatch(/required/)
		expect(html).toContain("Aviso # (if known)")
	})
})

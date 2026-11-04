import { createInstance } from "i18next"
import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import {
	MaterialsSourceChoice,
	PrefieldNeededChoice,
} from "~/components/intake-choices"
import { prefieldChoiceFor } from "~/lib/intake-answers"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))

import NewDoc from "./_app.docs.new"

async function render(node: ReactNode) {
	const i18n = createInstance()
	await i18n.use(initReactI18next).init({
		lng: "en",
		ns: "common",
		defaultNS: "common",
		resources,
	})
	const Stub = createRoutesStub([{ path: "/", Component: () => node }])
	return renderToString(
		<I18nextProvider i18n={i18n}>
			<Stub />
		</I18nextProvider>,
	)
}

function radio(html: string, name: string, value: string) {
	return html.match(
		new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>`),
	)?.[0]
}

describe("New work order form (render)", () => {
	const page = () =>
		render(
			<NewDoc
				{...({
					loaderData: {
						serviceCodes: [],
						showPrices: false,
						brigades: [],
						claroSupervisors: [
							{
								id: "cs-1",
								name: "Ana",
								requiresPrefield: true,
								requiresBlueprint: false,
							},
						],
						suggestions: { tipo: [], tipoPlanta: [], grupoPlan: [] },
					},
					actionData: undefined,
				} as any)}
			/>,
		)

	it("has no Aviso # input and never says Aviso", async () => {
		const html = await page()
		expect(html).not.toMatch(/name="avisoNumber"/)
		// The shared step rail still names step 6 (Aviso); the work-order
		// screen's own copy never does.
		const form = html.slice(html.indexOf("</ol>"))
		expect(form).toContain("Create Work Order")
		expect(form).not.toMatch(/Aviso/)
	})

	it("asks both intake questions, materials above the list and prefield above Create", async () => {
		const html = await page()
		for (const [name, value] of [
			["materialsFromWarehouse", "yes"],
			["materialsFromWarehouse", "no"],
			["prefieldNeeded", "needed"],
			["prefieldNeeded", "not_needed"],
		])
			expect(radio(html, name, value)).toBeDefined()
		const at = (s: string) => html.indexOf(s)
		expect(at('name="materialsFromWarehouse"')).toBeLessThan(
			at("Materials to prep"),
		)
		expect(at('name="prefieldNeeded"')).toBeGreaterThan(at("Materials to prep"))
		expect(at('name="prefieldNeeded"')).toBeLessThan(at("Create Work Order"))
	})

	it("pre-selects Prefield from the chosen Claro supervisor's tag", async () => {
		const needed = await render(
			<PrefieldNeededChoice
				value={prefieldChoiceFor({ requiresPrefield: true })}
				onChange={() => {}}
			/>,
		)
		expect(radio(needed, "prefieldNeeded", "needed")).toMatch(/checked/)
		expect(radio(needed, "prefieldNeeded", "not_needed")).not.toMatch(/checked/)
		const notNeeded = await render(
			<PrefieldNeededChoice
				value={prefieldChoiceFor({ requiresPrefield: false })}
				onChange={() => {}}
			/>,
		)
		expect(radio(notNeeded, "prefieldNeeded", "not_needed")).toMatch(/checked/)
		expect(prefieldChoiceFor(undefined)).toBe("")
	})

	it("on No hides the materials list and shows the reason box", async () => {
		const no = await render(
			<MaterialsSourceChoice value="no" onChange={() => {}}>
				<div data-testid="materials-list" />
			</MaterialsSourceChoice>,
		)
		expect(no).toMatch(/<textarea[^>]*name="materialsReason"/)
		expect(no).not.toContain("materials-list")
		const yes = await render(
			<MaterialsSourceChoice value="yes" onChange={() => {}}>
				<div data-testid="materials-list" />
			</MaterialsSourceChoice>,
		)
		expect(yes).not.toMatch(/name="materialsReason"/)
		expect(yes).toContain("materials-list")
	})
})

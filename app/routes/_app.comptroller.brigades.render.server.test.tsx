import { createInstance } from "i18next"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))

import Brigades from "./_app.comptroller.brigades"

async function render(actionData: unknown) {
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
				<Brigades
					{...({
						loaderData: { brigades: [], crewUsers: [], areaOptions: ["METRO"] },
						actionData,
					} as any)}
				/>
			),
		},
	])
	return renderToString(
		<I18nextProvider i18n={i18n}>
			<Stub />
		</I18nextProvider>,
	)
}

const row = (code: string, name: string, extra = {}) => ({
	code,
	name,
	baseCode: null,
	isEquipmentAccount: false,
	status: "INACTIVE",
	typeHint: null,
	checkWithLissette: null,
	...extra,
})

describe("Brigades page import (render)", () => {
	it("shows the Import from Excel button", async () => {
		const html = await render(undefined)
		expect(html).toContain("Import from Excel")
		expect(html).not.toContain('name="file"')
	})

	it("renders the preview with pre-selected, suggested and flagged rows", async () => {
		const html = await render({
			preview: {
				rows: [row("1", "A")],
				plan: {
					recodes: [{ brigadeId: "b1" }],
					suggestions: [],
					creates: [
						row("2", "B"),
						row("2D", "B", { isEquipmentAccount: true }),
					],
					skipped: [],
					flagged: [row("3", "C", { checkWithLissette: "Is this active?" })],
					ignoredOverrides: [],
				},
				brigades: [
					{
						id: "b1",
						name: "Old A",
						code: "9",
						selected: "1",
						options: [
							{ code: "1", name: "A", suggested: false },
							{ code: "5", name: "Close", suggested: true },
						],
					},
				],
			},
		})
		expect(html).toContain('name="file"')
		expect(html).toContain('accept=".csv,.xlsx"')
		expect(html).toContain("equipment “D” accounts: 1")
		expect(html).toContain("Is this active?")
		expect(html).toContain('name="override-b1"')
		expect(html).toContain("Leave alone")
		expect(html).toContain("Suggestions")
		expect(html).toMatch(/<option value="1" selected[^>]*>/)
		expect(html).toContain('name="rows"')
	})

	it("after an apply, lists the account codes left with the brigade they already pay", async () => {
		const html = await render({
			applied: { created: 1, recoded: 0, keptAccounts: ["100", "200D"] },
			ignoredOverrides: [],
		})
		expect(html).toContain("Import complete: 1 created, 0 recoded.")
		expect(html).toContain("still pay the brigade they belonged to")
		expect(html).toContain("100")
		expect(html).toContain("200D")
	})

	it("shows an import error in the import panel only", async () => {
		const html = await render({
			errorKey: "comptroller_brigades.errors.import_too_large",
			scope: "import",
		})
		expect(html).toContain("larger than 2 MB")
	})
})

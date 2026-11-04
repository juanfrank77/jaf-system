import { createInstance } from "i18next"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/pdf/warehouse-receipt.server", () => ({
	generateWarehouseReceiptPdf: vi.fn(),
}))

import SignDoc from "./_app.docs.$id_.sign"

async function render(over: Record<string, unknown> = {}) {
	const i18n = createInstance()
	await i18n.use(initReactI18next).init({
		lng: "en",
		ns: "common",
		defaultNS: "common",
		resources,
	})
	const loaderData = {
		doc: { id: "doc-1", controlNumber: "MAINT-261103-001", warehouseId: null },
		user: { id: "w1", role: "WAREHOUSE", name: "Orlando" },
		serviceCodes: [
			{ id: "m1", claroCode: "1005824", name: "CABLE SUPPORT", unit: "EA" },
		],
		warehouses: [{ id: "wh", name: "Guaynabo", zone: "METRO" }],
		warehouseUsers: [{ id: "w1", name: "Orlando" }],
		signerGroups: [
			{
				brigadeId: "b1",
				brigadeName: "CARLOS RODRIGUEZ",
				brigadeCode: "171",
				signers: [{ key: "b1:name", name: "Carlos Rodríguez", userId: null }],
			},
		],
		pickupErrorKey: null,
		releases: [],
		listed: [{ serviceCodeId: "m1", qty: 6 }],
		...over,
	}
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<SignDoc
					{...({
						loaderData,
						actionData: undefined,
						params: {},
					} as unknown as Parameters<typeof SignDoc>[0])}
				/>
			),
		},
	])
	return renderToString(
		<I18nextProvider i18n={i18n}>
			<Stub />
		</I18nextProvider>,
	).replace(/<!-- -->/g, "")
}

const release = {
	id: "r1",
	number: 1,
	releasedByName: "Orlando Guzmán",
	crewSignerName: "Carlos Rodríguez",
	crewSignerBrigadeName: "CARLOS RODRIGUEZ",
	crewSignerBrigadeCode: "171",
	materials: [{ serviceCodeId: "m1", qty: 2 }],
	createdAt: "2026-11-04T12:00:00.000Z",
}

describe("Warehouse Pickup: several releases", () => {
	it("starts on the signature form, with no release list and no way to complete", async () => {
		const html = await render()
		expect(html).toContain("Sign &amp; Lock Materials")
		expect(html).not.toContain('data-testid="pickup-releases"')
		expect(html).not.toContain("Release complete")
	})

	it("after a release: the list with signer and brigade, and the two next steps", async () => {
		const html = await render({ releases: [release] })
		expect(html).toContain("Releases on this work order")
		expect(html).toContain("Release 1")
		expect(html).toContain("Warehouse: Orlando Guzmán · Crew: Carlos Rodríguez")
		expect(html).toContain("CARLOS RODRIGUEZ (171)")
		expect(html).toContain("1005824 × 2")
		expect(html).toContain("+ Add another release")
		expect(html).toContain("Release complete → go to Step 4 · Work")
		// The form comes back only for another release.
		expect(html).not.toContain("Sign &amp; Lock Materials")
	})
})

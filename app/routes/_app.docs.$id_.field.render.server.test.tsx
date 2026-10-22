import { createInstance } from "i18next"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))

import FieldUpdate from "./_app.docs.$id_.field"

const photo = (id: string) => ({ id, src: `/files/photos/doc-1/${id}.jpg` })

function loaderData(overrides: Record<string, unknown> = {}) {
	return {
		user: { id: "sup-1", role: "SUPERVISOR" },
		doc: {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "SIGNED",
			// A job created before the Aviso-style address: no Dirección 1 yet.
			sector: null,
			direccion1: null,
			direccion2: null,
			latitud: null,
			longitud: null,
			ciudad: null,
			jobAddressEstimated: "Calle Luna 1, Cupey",
			jobAddressActual: null,
			fieldNotes: null,
			fieldStartedAt: null,
			fieldSubmittedAt: null,
		},
		addressCorrections: [
			{
				original: "Calle Luna 1",
				corrected: "Calle Luna 1, Cupey",
				correctedById: "sup-3",
				correctedAt: "2026-10-01T10:00:00.000Z",
			},
		],
		correctorNames: { "sup-3": "Sup Tres" },
		photos: {
			BEFORE: [photo("b1"), photo("b2"), photo("b3"), photo("b4")],
			DURING: [photo("d1")],
			AFTER: [],
		},
		blueprints: ["1-0-plan.pdf"],
		blueprintRequired: true,
		stage: "FIELD",
		materialsTaken: [{ serviceCodeId: "sc-1", qty: 5 }],
		estimatedMaterials: [{ serviceCodeId: "sc-1", qty: 4 }],
		fieldMaterials: [
			{
				serviceCodeId: "sc-1",
				used: 5,
				returned: 0,
				source: "WAREHOUSE_ISSUE",
			},
		],
		serviceLines: [
			{
				serviceCodeId: "svc-1",
				claroCode: "34006301",
				accountCode: "610",
				name: "TRANSFER",
				qty: 2,
			},
		],
		installedServiceLines: null,
		services: {
			rows: [
				{
					serviceCodeId: "svc-1",
					claroCode: "34006301",
					name: "TRANSFER",
					estimated: 2,
					actual: null,
					unit: "EA",
				},
			],
			brigadeNames: [],
		},
		serviceCodes: [
			{ id: "sc-1", claroCode: "M-1", name: "Cable", unit: "ft" },
			{ id: "sc-2", claroCode: "M-2", name: "Clamp", unit: "EA" },
		],
		...overrides,
	}
}

async function render(data = loaderData()) {
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
				<FieldUpdate
					{...({ loaderData: data, actionData: undefined } as any)}
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

const inputs = (html: string, re: RegExp) =>
	(html.match(/<input[^>]*>/g) ?? []).filter((i) => re.test(i))

describe("Field screen (render)", () => {
	it("marks Actual, Used and Source as required fields and offers Back", async () => {
		const html = await render()
		expect(inputs(html, /aria-label="Actual 34006301"/)[0]).toMatch(
			/class="[^"]*field-required/,
		)
		expect(inputs(html, /aria-label="Used"/)[0]).toMatch(
			/class="[^"]*field-required/,
		)
		expect(html).toMatch(
			/<select[^>]*aria-label="Source"[^>]*field-required|<select[^>]*field-required[^>]*aria-label="Source"/,
		)
		expect(html).toContain("Go back")
	})

	it("shows the 9-step supervisor bar, not the crew rail", async () => {
		const html = await render()
		expect(html).toContain("Intake")
		expect(html).toContain("In Finance")
		expect(html).toContain("Pre-cert sheet")
		expect(html).not.toContain("Supervisor · Finance")
	})

	it("orders the form Services, Materials, Photos, Field report, Address", async () => {
		const html = await render()
		const at = (needle: string) => {
			const i = html.indexOf(needle)
			expect(i, needle).toBeGreaterThan(-1)
			return i
		}
		const order = [
			at("Services performed"),
			at("Materials Used"),
			at("Before Photos"),
			at("Blueprint"),
			at("Field report"),
			at("On file:"),
		]
		expect(order).toEqual([...order].sort((x, y) => x - y))
	})

	it("has no Prefield card (Prefield is filled in at the Aviso step, not here)", async () => {
		const html = await render()
		expect(html).not.toContain("Prefield")
		expect(html).not.toContain("Aviso step")
	})

	it("asks the supervisor for the material source the crew reports", async () => {
		const html = await render()
		expect(html).toContain("Field report")
		expect(html).toMatch(/placeholder="[^"]*where the materials came from/i)
	})

	it("both file inputs accept exactly JPG, PNG and PDF", async () => {
		const html = await render()
		const accepts = [...html.matchAll(/type="file"[^>]*accept="([^"]*)"/g)]
		const alt = [...html.matchAll(/accept="([^"]*)"[^>]*type="file"/g)]
		const all = [...accepts, ...alt].map((m) => m[1])
		expect(all.length).toBeGreaterThan(0)
		for (const a of all) expect(a).toBe("image/jpeg,image/png,application/pdf")
	})

	it("shows a PDF photo as a file link, not a broken image", async () => {
		const html = await render(
			loaderData({
				photos: {
					BEFORE: [{ id: "p1", src: "/files/photos/doc-1/scan.pdf" }],
					DURING: [],
					AFTER: [],
				},
			}),
		)
		expect(html).toContain('data-testid="photo-pdf"')
		expect(html).not.toContain('<img src="/files/photos/doc-1/scan.pdf"')
		expect(html).toContain('href="/files/photos/doc-1/scan.pdf"')
	})

	it("marks the Field report required", async () => {
		const html = await render()
		expect(html).toMatch(/<textarea[^>]*field-required/)
	})

	it("does not backfill Dirección 1 with the composed job address", async () => {
		const html = await render()
		const [d1] = inputs(html, /id="direccion1"/)
		expect(d1).toBeDefined()
		expect(d1).not.toMatch(/value="Calle Luna 1, Cupey"/)
		expect(d1).toMatch(/placeholder="Calle Luna 1, Cupey"/)
		// Unedited address fields are not posted, so Save progress on such a
		// job never trips "Dirección 1 is required".
		expect(d1).not.toMatch(/name=/)
	})

	it("shows the address correction history with who and when", async () => {
		const html = await render()
		expect(html).toContain("Calle Luna 1, Cupey")
		expect(html).toContain("Edited by Sup Tres")
	})

	it("has Before / During / After boxes of four, upload only while a box has room", async () => {
		const html = await render()
		expect(html).toContain("Before Photos")
		expect(html).toContain("During Photos")
		expect(html).toContain("After Photos")
		expect(inputs(html, /name="photosBefore"/)).toHaveLength(0)
		expect(inputs(html, /name="photosDuring"/)).toHaveLength(1)
		expect(inputs(html, /name="photosAfter"/)).toHaveLength(1)
		expect(html.match(/data-testid="photo-slot-empty"/g)).toHaveLength(3 + 4)
	})

	it("lists blueprints with a link and the Claro supervisor hint", async () => {
		const html = await render()
		expect(html).toContain('href="/files/blueprints/doc-1/1-0-plan.pdf"')
		expect(html).toContain("Required by this Claro supervisor")
		expect(inputs(html, /name="blueprint"/)).toHaveLength(1)
		const plain = await render(loaderData({ blueprintRequired: false }))
		expect(plain).not.toContain("Required by this Claro supervisor")
	})

	it("services table has no prices and a brigade column only on shared jobs", async () => {
		const html = await render()
		expect(html).toContain("34006301")
		expect(html).not.toMatch(/\$\s?\d/)
		expect(html).not.toContain(">Brigade<")
		const shared = await render(
			loaderData({
				services: {
					...loaderData().services,
					brigadeNames: ["Brigada Uno", "Brigada Dos"],
				},
			}),
		)
		expect(shared).toContain(">Brigade<")
		expect(shared).toContain("Brigada Uno")
	})

	it("one materials table and the two actions", async () => {
		const html = await render()
		expect(html.match(/data-testid="field-materials"/g)).toHaveLength(1)
		expect(html).toContain("Issued (signed)")
		expect(html).toContain("Save progress")
		expect(html).toContain("Continue to 4. Sign off")
	})
})

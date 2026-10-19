import { createInstance } from "i18next"
import { renderToString } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { createRoutesStub } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { resources } from "~/localization/resource"

vi.mock("~/lib/db.server", () => ({ db: {} }))

import ReviewDoc from "./_app.docs.$id_.review"

function loaderData(doc: Record<string, unknown> = {}, interactive = true) {
	return {
		doc: {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "FIELD_UPDATED",
			jobType: "Mantenimiento",
			jobAddressEstimated: "Calle Luna 1, Cupey",
			addressCorrections: null,
			fieldNotes: null,
			estimatedMaterials: [],
			materialsTaken: [],
			materialsUsed: [],
			preppedMaterials: [],
			serviceLines: [],
			installedServiceLines: [],
			jafInvoiceLines: null,
			avisoLines: null,
			supervisorApprovedAt: null,
			completionSignature: null,
			completionSignedAt: null,
			completedById: null,
			fieldSubmittedAt: null,
			...doc,
		},
		user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
		serviceCodes: [],
		photos: [],
		supervisor: null,
		sheet: null,
		brigade: null,
		stage: "APPROVE",
		openLabel: null,
		view: "APPROVE",
		interactive,
		gate: { ok: false, conditions: [] },
		invoiceSummary: null,
		invoiceNumber: null,
		invoicePreview: [],
		invoiceHeader: {},
		showPrices: false,
		tolerance: 0.01,
		correctorNames: {},
		signedOffBy: null as string | null,
	}
}

async function render(data: ReturnType<typeof loaderData>) {
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
				<ReviewDoc {...({ loaderData: data, actionData: undefined } as any)} />
			),
		},
	])
	return renderToString(
		<I18nextProvider i18n={i18n}>
			<Stub />
		</I18nextProvider>,
	)
}

describe("Sign off step (render)", () => {
	it("asks for a drawn signature with the supervisor's name, and offers no send-back to crew", async () => {
		const html = await render(loaderData())
		expect(html).toContain("Sign off the field work")
		expect(html).toMatch(/<input[^>]*name="intent"[^>]*value="approve"/)
		expect(html).toMatch(/<input[^>]*name="completionSignature"/)
		expect(html).toContain("<canvas")
		expect(html).toContain("Edgard Ocasio")
		expect(html).not.toContain('value="send_back"')
		expect(html).not.toContain("Send Back to Crew")
		expect(html).not.toContain("Approve field work")
	})

	it("once signed, shows the signature and who signed instead of the pad", async () => {
		const html = await render({
			...loaderData(
				{
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
					completionSignature: "data:image/png;base64,abc",
					completionSignedAt: "2026-10-18T10:00:00.000Z",
					completedById: "sup-1",
				},
				false,
			),
			signedOffBy: "Edgard Ocasio",
		})
		expect(html).toContain('src="data:image/png;base64,abc"')
		expect(html).toContain("Signed off by Edgard Ocasio")
		expect(html).not.toContain("<canvas")
	})
})

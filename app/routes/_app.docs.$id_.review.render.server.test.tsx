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
		avisoAmountOk: null,
		packet: packetData(),
		signedOffBy: null as string | null,
	}
}

function packetData(over: Record<string, unknown> = {}) {
	return {
		sent: false,
		sentAt: null as string | null,
		claroSupervisor: {
			name: "Ramón Claro",
			email: "ramon.now@claro.example",
			requiresPrefield: true,
		},
		claroSupervisorId: "claro-1",
		claroOptions: [],
		showPrefield: true,
		prefield: {
			avisoNumber: null,
			ordenNumber: "ORD-77",
			pedido: "P-1",
			smr: "SMR-9",
			titulo: "Poste nuevo",
			description: "Instalar poste",
		},
		prefieldMissing: [] as string[],
		blockers: [] as string[],
		packetHref: null as string | null,
		blueprints: [
			{ name: "plano 1.pdf", href: "/files/blueprints/doc-1/plano%201.pdf" },
			{ name: "plano 2.pdf", href: "/files/blueprints/doc-1/plano%202.pdf" },
		],
		materials: [
			{
				claroCode: "M-100",
				name: "Cable drop",
				unit: "FT",
				used: 3,
				returned: 1,
				source: "WAREHOUSE",
			},
		],
		history: [] as Record<string, unknown>[],
		canMarkManual: false,
		...over,
	}
}

async function render(
	data: Record<string, unknown>,
	actionData?: Record<string, unknown>,
	lng: "en" | "es" = "en",
) {
	const i18n = createInstance()
	await i18n.use(initReactI18next).init({
		lng,
		ns: "common",
		defaultNS: "common",
		resources,
	})
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<ReviewDoc {...({ loaderData: data, actionData } as any)} />
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

describe("Packet → Claro step (render)", () => {
	const INSTALLED = [
		{
			serviceCodeId: "c1",
			claroCode: "34006301",
			accountCode: "610",
			name: "TRANSFER ATTCH DE POSTESMC",
			unit: "EA",
			qty: 5,
		},
	]
	const step5 = (packet = {}, doc = {}) => ({
		...loaderData({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
			jafInvoiceGeneratedAt: null,
			...doc,
		}),
		stage: "INVOICE",
		view: "INVOICE",
		invoicePreview: INSTALLED,
		invoiceHeader: {
			controlNumber: "JAF-1001",
			jobType: "Mantenimiento",
			address: "Calle Luna 1, Cupey",
			brigadeName: "JESUS MARTINEZ",
			workDate: null,
		},
		packet: packetData(packet),
	})

	it("offers one Send button behind a confirm naming the current Claro supervisor email", async () => {
		const html = await render(step5())
		expect(html).toContain("Packet → Claro")
		expect(html).toMatch(/<input[^>]*name="intent"[^>]*value="send_packet"/)
		expect(html).toContain("Send to Claro supervisor")
		expect(html).toContain("ramon.now@claro.example")
		expect(html).toContain(
			'data-confirm="Email the packet to ramon.now@claro.example?"',
		)
		expect(html).not.toContain("generate_jaf_invoice")
		expect(html).not.toContain("Reviewed, ready for Claro")
		// Not delivered yet: no manual path, no Resend.
		expect(html).not.toContain('value="mark_packet_sent"')
		expect(html).not.toContain(">Resend<")
	})

	it("shows the Prefield, work summary without prices, materials and blueprint links", async () => {
		const html = await render(step5())
		expect(html).toContain("Prefield")
		expect(html).toContain("ORD-77")
		expect(html).toContain("SMR-9")
		expect(html).toContain("34006301")
		expect(html).not.toContain("$")
		expect(html).toContain("Cable drop")
		expect(html).toContain('href="/files/blueprints/doc-1/plano%201.pdf"')
		expect(html).toContain('href="/files/blueprints/doc-1/plano%202.pdf"')
	})

	it("once sent, leaves the Prefield out when the Claro supervisor does not require it", async () => {
		const html = await render(
			step5(
				{
					showPrefield: false,
					sent: true,
					sentAt: "2026-10-18T12:00:00.000Z",
				},
				{ jafInvoiceGeneratedAt: "2026-10-18T12:00:00.000Z" },
			),
		)
		expect(html).not.toContain("ORD-77")
		expect(html).not.toContain('value="save_prefield"')
	})

	it("before the first send the Prefield and the Claro supervisor are editable", async () => {
		const html = await render(
			step5({
				claroOptions: [
					{
						id: "claro-1",
						name: "Ramón Claro",
						email: "ramon.now@claro.example",
						requiresPrefield: true,
						requiresBlueprint: false,
					},
					{
						id: "claro-2",
						name: "Ana Claro",
						email: "ana@claro.example",
						requiresPrefield: false,
						requiresBlueprint: false,
					},
				],
			}),
		)
		expect(html).toContain('value="save_prefield"')
		expect(html).toMatch(/<select[^>]*name="claroSupervisorId"/)
		expect(html).toMatch(/<option value="claro-1" selected="">Ramón Claro/)
		expect(html).toContain("Ana Claro")
		for (const name of [
			"avisoNumber",
			"ordenNumber",
			"pedido",
			"smr",
			"titulo",
		])
			expect(html).toContain(`name="${name}"`)
		expect(html).toMatch(
			/name="ordenNumber"[^>]*value="ORD-77"|value="ORD-77"[^>]*name="ordenNumber"/,
		)
		// No blueprint is required here, so there is no upload.
		expect(html).not.toContain('name="blueprint"')
	})

	it("offers the blueprint upload when the Claro supervisor requires one and there is none", async () => {
		const html = await render(
			step5({ blockers: ["blueprint"], blueprints: [] }),
		)
		expect(html).toContain('name="blueprint"')
		expect(html).toContain("upload in the Prefield form below")
	})

	it("is read-only after the first send", async () => {
		const html = await render(
			step5(
				{ sent: true, sentAt: "2026-10-18T12:00:00.000Z" },
				{ jafInvoiceGeneratedAt: "2026-10-18T12:00:00.000Z" },
			),
		)
		expect(html).toContain("ORD-77")
		expect(html).not.toContain('value="save_prefield"')
	})

	it("lists the blockers and disables Send", async () => {
		const html = await render(
			step5({
				blockers: ["prefield", "blueprint"],
				prefieldMissing: ["pedido", "smr"],
			}),
		)
		expect(html).toContain("Before the packet can be sent:")
		expect(html).toContain("Prefield: fill in Pedido, SMR")
		expect(html).toContain("Add a blueprint")
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*>Send to Claro supervisor/,
		)
	})

	it("after an UNCONFIGURED attempt: says so, offers the download and Mark as sent manually", async () => {
		const html = await render(
			step5({
				packetHref: "/files/packets/doc-1-packet-1-ab.pdf",
				canMarkManual: true,
				history: [
					{
						id: "ps-1",
						sentAt: "2026-10-18T14:00:00.000Z",
						sentBy: "Edgard Ocasio",
						recipientEmail: "ramon.now@claro.example",
						outcome: "UNCONFIGURED",
						error: null,
					},
				],
			}),
		)
		expect(html).toContain("Email is not set up on this server")
		expect(html).toContain('href="/files/packets/doc-1-packet-1-ab.pdf"')
		expect(html).toContain("Download packet")
		expect(html).toMatch(
			/<input[^>]*name="intent"[^>]*value="mark_packet_sent"/,
		)
		expect(html).toContain("Mark as sent manually")
		// Still not sent: the main button keeps its first-send label.
		expect(html).toContain("Send to Claro supervisor")
		expect(html).toContain("Not sent yet")
	})

	it("once sent: Resend, the send history, and the next step", async () => {
		const html = await render(
			step5(
				{
					sent: true,
					sentAt: "2026-10-18T15:00:00.000Z",
					packetHref: "/files/packets/doc-1-packet-2-cd.pdf",
					history: [
						{
							id: "ps-2",
							sentAt: "2026-10-18T15:00:00.000Z",
							sentBy: "Edgard Ocasio",
							recipientEmail: "ramon.now@claro.example",
							outcome: "SENT",
							error: null,
						},
						{
							id: "ps-1",
							sentAt: "2026-10-18T14:00:00.000Z",
							sentBy: "Edgard Ocasio",
							recipientEmail: "ramon.old@claro.example",
							outcome: "FAILED",
							error: "connect ECONNREFUSED",
						},
					],
				},
				{ jafInvoiceGeneratedAt: "2026-10-18T15:00:00.000Z" },
			),
		)
		expect(html).toContain(">Resend<")
		expect(html).toContain(
			'data-confirm="Email the packet again to ramon.now@claro.example?',
		)
		expect(html).toContain("Sent to Claro on")
		expect(html).toContain('data-testid="packet-history"')
		expect(html).toContain("ramon.old@claro.example")
		expect(html).toContain("Failed")
		expect(html).toContain("connect ECONNREFUSED")
		expect(html).not.toContain('value="back_to_approve"')
		expect(html).not.toContain("Back to Sign off")
	})

	it.each([
		[
			"packet.errors.prefield_missing",
			"This Claro supervisor requires the Prefield form",
		],
		[
			"packet.errors.blueprint_missing",
			"This Claro supervisor requires a blueprint",
		],
		[
			"packet.errors.no_claro_supervisor",
			"Choose the Claro supervisor for this job",
		],
		["packet.errors.not_signed_off", "Sign off the field work before sending"],
		["packet.errors.locked", "already been released to Finance"],
		["packet.errors.render_failed", "The packet PDF could not be built"],
		[
			"docs_review.errors.installed_lines_required",
			"No installed quantities per service code were recorded",
		],
	])("maps %s to a message", async (errorKey, text) => {
		const html = await render(step5(), { errorKey })
		expect(html).toContain(text)
		expect(html).not.toContain(errorKey)
	})

	it("speaks Spanish too", async () => {
		const html = await render(
			step5(),
			{ errorKey: "packet.errors.blueprint_missing" },
			"es",
		)
		expect(html).toContain("Enviar al supervisor de Claro")
		expect(html).toContain("Este supervisor de Claro requiere un plano")
		expect(html).toContain(
			"¿Enviar el paquete por correo a ramon.now@claro.example?",
		)
	})

	it("a read-only view of the step has no send controls", async () => {
		const html = await render({ ...step5(), interactive: false })
		expect(html).not.toContain('value="send_packet"')
		expect(html).toContain("Packet → Claro")
	})
})

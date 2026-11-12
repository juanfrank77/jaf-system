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
		supervisor: null,
		sheet: null,
		sheets: [],
		brigade: null,
		stage: "APPROVE",
		openLabel: null,
		view: "APPROVE",
		interactive,
		gate: { ok: false, rows: [] },
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
		},
		claroSupervisorId: "claro-1",
		claroOptions: [],
		prefieldNeeded: true,
		blockers: [] as string[],
		packetHref: null as string | null,
		files: [] as Record<string, string>[],
		zipHref: null as string | null,
		materials: [
			{
				serviceCodeId: "m1",
				claroCode: "M-100",
				name: "Cable drop",
				unit: "FT",
				used: 3,
				returned: 1,
				source: "WAREHOUSE_ISSUE",
			},
		],
		history: [] as Record<string, unknown>[],
		canMarkManual: false,
		emailEnabled: true,
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

	it("lights the signature box, counts it, and keeps the Sign off button pressable", async () => {
		const html = await render(loaderData())
		expect(html).toContain("1 box left")
		expect(html).toMatch(
			/data-guide="next" class="[^"]*guide-next[^"]*"><canvas/,
		)
		expect(html).toMatch(
			/<button(?![^>]*(aria-disabled=|\sdisabled[=\s>]))[^>]*>Sign off<\/button>/,
		)
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

describe("Step 4 · the work order document (render)", () => {
	const WO = {
		workOrderNumber: "JAF-1001",
		claroSupervisor: "Ramón Claro",
		jafSupervisor: "Edgard Ocasio",
		crews: [{ name: "JESUS MARTINEZ", contractNumber: "009" }],
		address: "Bo. Cupey, Calle Luna 1, San Juan",
		description: "Instalar poste",
		services: [{ code: "34006301", description: "TRANSFER ATTCH", qty: 5 }],
		materials: [
			{ name: "Cable drop", used: 3, unit: "FT", source: "WAREHOUSE_ISSUE" },
		],
		materialsFromWarehouse: true,
		materialsReason: null,
		fieldReport: null,
		signatures: {
			supervisor: "pending",
			warehouse: "pending",
			crew: "pending",
		},
	}
	const step4 = (over: Record<string, unknown> = {}, doc = {}) => ({
		...loaderData(doc),
		workOrder: WO,
		workOrderIssuedOn: "2026-10-19T15:00:00.000Z",
		canGeneratePdf: false,
		...over,
	})

	it("shows the banner, the document, the sign-off below it, a disabled Generate package and Back to step 3", async () => {
		const html = await render(step4())
		expect(html).toContain(
			"Check the document below, sign, and generate the package for the Claro supervisor.",
		)
		expect(html).toContain("JAF Work Order")
		expect(html).toContain("JESUS MARTINEZ · 009")
		expect(html).toContain("Bo. Cupey, Calle Luna 1, San Juan")
		expect(html.indexOf("JAF Work Order")).toBeLessThan(
			html.indexOf("Sign off the field work"),
		)
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate package/)
		expect(html).not.toContain("Continue to step 5")
		expect(html).toContain('href="/docs/doc-1/field"')
		expect(html).toContain("Back to step 3")
		// The old cards are gone; no prices, no Difference, no job location.
		expect(html).not.toContain("Certified address")
		expect(html).not.toContain("Ordered vs Installed")
		expect(html).not.toMatch(/\$|Difference|Job location/)
	})

	it("once signed: Generate package is enabled on the step, no read-only banner, no Back", async () => {
		const html = await render(
			step4(
				{ stage: "INVOICE", interactive: false, canGeneratePdf: true },
				{
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
					completionSignature: "data:image/png;base64,abc",
				},
			),
		)
		expect(html).toMatch(
			/<input[^>]*name="intent"[^>]*value="generate_package"/,
		)
		expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Generate package/)
		expect(html).not.toContain("Completed step.")
		expect(html).not.toContain("Back to step 3")
	})

	it("after Generate package, offers Continue to step 5; not while the package is stale", async () => {
		const signed = {
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
			completionSignature: "data:image/png;base64,abc",
		}
		const generated = packetData({
			packetHref: "/files/packets/doc-1-work-order-1.pdf",
		})
		const html = await render(
			step4(
				{
					stage: "INVOICE",
					interactive: false,
					canGeneratePdf: true,
					packet: generated,
				},
				signed,
			),
		)
		expect(html).toContain("Package generated")
		expect(html).toMatch(
			/<a[^>]*href="\/docs\/doc-1\/review\?step=INVOICE"[^>]*>Continue to step 5/,
		)
		const stale = await render(
			step4(
				{
					stage: "INVOICE",
					interactive: false,
					canGeneratePdf: true,
					packet: generated,
				},
				{ ...signed, packetStale: true },
			),
		)
		expect(stale).not.toContain("Continue to step 5")
	})

	it("once signed, says Generate package needs a Claro supervisor and links to step 5 to choose one", async () => {
		const html = await render(
			step4(
				{
					stage: "INVOICE",
					interactive: false,
					canGeneratePdf: false,
					packet: packetData({
						blockers: ["claro_supervisor", "prefield_pdf"],
					}),
				},
				{
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
					completionSignature: "data:image/png;base64,abc",
				},
			),
		)
		expect(html).toContain("Before the package can be generated:")
		expect(html).toContain("Choose the Claro supervisor for this job")
		// The Prefield never blocks generating: it is what Generate makes.
		expect(html).not.toContain("Prefield")
		expect(html).toContain('href="/?step=INVOICE"')
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate package/)
	})

	it("speaks Spanish too", async () => {
		const html = await render(step4(), undefined, "es")
		expect(html).toContain("Orden de trabajo JAF")
		expect(html).toContain("Generar paquete")
		expect(html).toContain("Pendiente")
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
		expect(html).toContain("Send to Ramón Claro")
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

	it("has no Prefield inputs, and leaves the work summary and materials to step 4", async () => {
		const html = await render(step5())
		for (const name of ["ordenNumber", "pedido", "smr", "titulo"])
			expect(html).not.toContain(`name="${name}"`)
		expect(html).not.toContain("34006301")
		expect(html).not.toContain("Cable drop")
		expect(html).not.toContain("Work summary")
		expect(html).not.toContain("$")
	})

	it("lists the package files, each with its download, and Download all", async () => {
		const html = await render(
			step5({
				files: [
					{
						key: "work_order_pdf",
						name: "doc-1-work-order-1.pdf",
						fileName: "JAF work order MAINT-1.pdf",
						href: "/files/packets/doc-1-work-order-1.pdf",
					},
					{
						key: "prefield_pdf",
						name: "doc-1-prefield-1.pdf",
						fileName: "Prefield MAINT-1.pdf",
						href: "/files/packets/doc-1-prefield-1.pdf",
					},
					{
						key: "photo",
						name: "before.jpg",
						fileName: "Photo 1 - before.jpg",
						href: "/files/photos/doc-1/before.jpg",
					},
					{
						key: "blueprint",
						name: "plano 1.pdf",
						fileName: "Blueprint 1.pdf",
						href: "/files/blueprints/doc-1/plano%201.pdf",
					},
				],
				zipHref: "/docs/doc-1/package",
			}),
		)
		expect(html).toContain("Files for Claro")
		for (const href of [
			"/files/packets/doc-1-work-order-1.pdf",
			"/files/packets/doc-1-prefield-1.pdf",
			"/files/photos/doc-1/before.jpg",
			"/files/blueprints/doc-1/plano%201.pdf",
		])
			expect(html).toContain(`href="${href}"`)
		expect(html.match(/aria-label="Download /g)).toHaveLength(4)
		expect(html.match(/aria-label="View /g)).toHaveLength(4)
		expect(html).toContain("Photo 1 - before.jpg")
		expect(html).toMatch(
			/<a[^>]*href="\/docs\/doc-1\/package"[^>]*>⬇ Download all/,
		)
		expect(html).toContain("Claro Prefield (PDF)")
		expect(html).not.toMatch(/Aviso \(PDF\)|Certificado/)
	})

	it("before the first send the Claro supervisor is editable", async () => {
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
		expect(html).toContain('value="save_packet_details"')
		// A type-to-search box (the list opens on focus), posting the chosen id.
		expect(html).toMatch(
			/<input type="hidden" name="claroSupervisorId" value="claro-1"/,
		)
		expect(html).toContain('value="Ramón Claro · ramon.now@claro.example"')
		// The Prefield boxes are Claro's; the Aviso # comes at step 6.
		for (const name of [
			"ordenNumber",
			"pedido",
			"smr",
			"titulo",
			"avisoNumber",
		])
			expect(html).not.toContain(`name="${name}"`)
		// No blueprint is required here, so there is no upload.
		expect(html).not.toContain('name="blueprint"')
	})

	it("offers the blueprint upload when the Claro supervisor requires one and there is none", async () => {
		const html = await render(step5({ blockers: ["blueprint"] }))
		expect(html).toContain('name="blueprint"')
		expect(html).toContain("Add a blueprint with the upload below")
	})

	it("is read-only after the first send", async () => {
		const html = await render(
			step5(
				{ sent: true, sentAt: "2026-10-18T12:00:00.000Z" },
				{ jafInvoiceGeneratedAt: "2026-10-18T12:00:00.000Z" },
			),
		)
		expect(html).not.toContain('value="save_packet_details"')
	})

	it("lists the blockers and disables Send", async () => {
		const html = await render(
			step5({ blockers: ["prefield_pdf", "stale", "blueprint"] }),
		)
		expect(html).toContain("Before the packet can be sent:")
		expect(html).toContain(
			"Prefield PDF: this job needs one. Generate the package at step 4.",
		)
		expect(html).toContain(
			"The work order answers changed after the package was generated.",
		)
		expect(html).toContain("Add a blueprint")
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send to Ramón Claro/)
	})

	it("after an UNCONFIGURED attempt: says so, offers the download and Mark as sent manually", async () => {
		const html = await render(
			step5({
				packetHref: "/files/packets/doc-1-packet-1-ab.pdf",
				files: [
					{
						key: "work_order_pdf",
						name: "doc-1-packet-1-ab.pdf",
						href: "/files/packets/doc-1-packet-1-ab.pdf",
					},
				],
				zipHref: "/docs/doc-1/package",
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
		expect(html).toContain("Download all")
		expect(html).toMatch(
			/<input[^>]*name="intent"[^>]*value="mark_packet_sent"/,
		)
		expect(html).toContain("Mark as sent manually")
		// Still not sent: the main button keeps its first-send label.
		expect(html).toContain("Send to Ramón Claro")
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
		["packet.errors.prefield_pdf_missing", "This job needs the Prefield PDF"],
		["packet.errors.package_stale", "The package is out of date"],
		[
			"packet.errors.blueprint_missing",
			"This Claro supervisor requires a blueprint",
		],
		[
			"packet.errors.no_claro_supervisor",
			"Choose the Claro supervisor for this job",
		],
		["packet.errors.not_signed_off", "Sign off the field work before sending"],
		["packet.errors.locked", "released to Finance or closed"],
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
		expect(html).toContain("Enviar a Ramón Claro")
		expect(html).toContain("Este supervisor de Claro requiere un plano")
		expect(html).toContain(
			"¿Enviar el paquete por correo a ramon.now@claro.example?",
		)
	})

	it("with email off, there is a single Back link to Sign off before the send", async () => {
		const html = await render(
			step5({
				emailEnabled: false,
				packetHref: "/files/packets/doc-1-work-order-1.pdf",
				canMarkManual: true,
			}),
		)
		expect(html).toContain('value="mark_packet_sent"')
		expect(html).not.toContain("Back to Sign off")
		expect(html.match(/← <!-- -->Back/g)).toHaveLength(1)
		expect(html).toContain(
			"Send the package to the Claro supervisor, who creates the Aviso from your work order.",
		)
		const sent = await render(
			step5(
				{
					emailEnabled: false,
					sent: true,
					sentAt: "2026-10-18T15:00:00.000Z",
					packetHref: "/files/packets/doc-1-work-order-1.pdf",
				},
				{ jafInvoiceGeneratedAt: "2026-10-18T15:00:00.000Z" },
			),
		)
		expect(sent).not.toContain("Back to Sign off")
	})

	it("a read-only view of the step has no send controls", async () => {
		const html = await render({ ...step5(), interactive: false })
		expect(html).not.toContain('value="send_packet"')
		expect(html).toContain("Packet → Claro")
	})
})

describe("Pre-cert step (render)", () => {
	const precertSheet = {
		id: "s1",
		version: 1,
		lines: [],
		pdfPath: "/u/precert/doc-1-v1.pdf",
		sigSupervisorAt: "2026-10-26T10:00:00.000Z",
		sigSupervisorName: "Edgard Ocasio",
		sigSupervisorImage: null,
	}
	const precert = (interactive: boolean, doc = {}) => ({
		...loaderData(
			{
				status: "SUPERVISOR_APPROVED",
				supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
				jafInvoiceGeneratedAt: "2026-10-18T11:00:00.000Z",
				avisoNumber: "10359519",
				avisoDocPath: "/u/aviso/doc-1.pdf",
				...doc,
			},
			interactive,
		),
		stage: "RELEASE",
		view: "PRECERT",
		invoiceHeader: { address: "Calle Luna 1" },
		sheet: precertSheet,
		sheets: [precertSheet],
	})

	it("a completed (read-only) step offers no Continue or back-to-Aviso button, only the banner's way back", async () => {
		const html = await render(precert(false))
		expect(html).toContain("Completed step.")
		expect(html).toContain("Back to the current step")
		expect(html).not.toContain("Continue to Release")
		expect(html).not.toContain("← Aviso")
	})

	it("downloads the sheet with the same ⬇ button as Packet → Claro, under a friendly name", async () => {
		const html = await render(precert(false))
		const link = html.match(
			/<a[^>]*href="\/files\/precert\/doc-1-v1\.pdf"[^>]*>/,
		)
		expect(link?.[0]).toContain('download="Pre-cert JAF-1001 v1.pdf"')
		expect(html).toMatch(/<a[^>]*precert[^>]*>.*?Download PDF/s)
	})
})

describe("Fix a mistake (render)", () => {
	const signed = (doc = {}, role = "SUPERVISOR") => ({
		...loaderData(
			{
				status: "SUPERVISOR_APPROVED",
				supervisorApprovedAt: "2026-10-18T10:00:00.000Z",
				...doc,
			},
			false,
		),
		user: { id: "u1", role, name: "Edgard Ocasio" },
	})

	it("offers the button on a signed job that has not been sent, to reopen it", async () => {
		const html = await render({
			...signed(),
			fixMode: "reopen",
		})
		expect(html).toContain('data-testid="fix-mistake"')
		expect(html).toContain("Fix a mistake")
	})

	it("says the job was sent and an administrator reopens it, after the send", async () => {
		const html = await render({
			...signed({ jafInvoiceGeneratedAt: "2026-10-19T10:00:00.000Z" }),
			fixMode: "request",
		})
		expect(html).toContain("Fix a mistake")
	})

	it("is not there when the loader says there is nothing to fix", async () => {
		const html = await render({ ...signed(), fixMode: null })
		expect(html).not.toContain("Fix a mistake")
	})
})

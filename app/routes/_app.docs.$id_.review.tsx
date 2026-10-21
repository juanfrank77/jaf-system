import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ParseKeys } from "i18next"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { AvisoCard } from "~/components/aviso-card"
import { DocStageBadge } from "~/components/doc-stage-badge"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	type PacketBlocker,
	PacketStepCard,
	type PacketStepData,
} from "~/components/packet-step"
import { PhotosCard } from "~/components/review-field-work"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { SupervisorStepRail } from "~/components/supervisor-step-rail"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Pill } from "~/components/ui/pill"
import {
	GenerateWorkOrderPdf,
	WorkOrderDocumentCard,
} from "~/components/work-order-document"
import { isAvisoSaved } from "~/lib/aviso-document"
import {
	AvisoPdfError,
	normaliseAvisoNumber,
	readAvisoNumber,
} from "~/lib/aviso-pdf.server"
import {
	CONTRACTOR_SHARE_PERCENT,
	RETENTION_RATE,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { isPacketEmailEnabled } from "~/lib/features.server"
import { fieldMaterialsOrDefault } from "~/lib/field-materials"
import type { AddressCorrection } from "~/lib/field-update-helpers"
import {
	uploadFileName,
	validateBlueprintFile,
	validateFile,
} from "~/lib/file-upload.server"
import { invoiceNumberFor } from "~/lib/invoice-number"
import { openJobLabel } from "~/lib/open-job-label"
import {
	buildPacketInput,
	loadWorkOrderDocument,
	sendPacket,
} from "~/lib/packet-send.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"
import { canTransition, isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	activeSheet,
	createPreCertSheet,
	isSheetSigned,
	preCertLinesFor,
	renderPreCert,
} from "~/lib/pre-cert.server"
import { packetBlockers, prefieldMissing } from "~/lib/prefield"
import { evaluateReleaseGate, isPacketPath } from "~/lib/release-gate"
import {
	getActiveServiceCodes,
	isPriceBlind,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import {
	buildInvoiceLines,
	type InvoiceLine,
	type PreCertLine,
	round2,
	type ServiceLine,
	splitServiceSuffix,
	sumLines,
} from "~/lib/service-lines"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	isAvisoStarted,
	panelForStep,
	resolveStepView,
	SUPERVISOR_STAGES,
} from "~/lib/supervisor-stage"
import { getIvuRate } from "~/lib/system-settings.server"
import { isLegacyPricedInvoice, uploadHref } from "~/lib/upload-href"
import { photosThatLoad, saveBuffer, saveUpload } from "~/lib/uploads.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { PreCertSheet, Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.review"

type MaterialLine = { serviceCodeId: string; qty: number }

/** The Prefield inputs the packet step edits (Aviso # is entered at step 6). */
const PREFIELD_INPUTS = ["ordenNumber", "pedido", "smr", "titulo"] as const

const AVISO_PDF_ERROR_KEYS = {
	unreadable: "docs_review.errors.aviso_pdf_unreadable",
	no_number: "docs_review.errors.aviso_pdf_no_number",
	multiple_numbers: "docs_review.errors.aviso_pdf_multiple",
} as const

const showPricesFor = (role: string) => !isPriceBlind(role)

/** The Aviso PDF on record, or null when it cannot be read back. */
async function readPdf(file: string): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await readFile(file))
	} catch {
		return null
	}
}

/**
 * Step 6's one check: the 8-digit number on the file equals the typed one. A
 * scan, an empty PDF or one with several numbers is refused with its own
 * message; a different number is refused with both numbers.
 */
async function checkAvisoNumber(
	typed: string,
	pdf: Uint8Array,
): Promise<
	| { avisoNumber: string }
	| { errorKey: string; typedNumber?: string; pdfAvisoNumber?: string }
> {
	let onFile: string
	try {
		onFile = await readAvisoNumber(pdf)
	} catch (e) {
		if (!(e instanceof AvisoPdfError)) throw e
		return { errorKey: AVISO_PDF_ERROR_KEYS[e.code] }
	}
	if (normaliseAvisoNumber(typed) !== onFile)
		return {
			errorKey: "docs_review.errors.aviso_number_mismatch",
			typedNumber: typed,
			pdfAvisoNumber: onFile,
		}
	return { avisoNumber: onFile }
}

const isSig = (v: unknown) =>
	typeof v === "string" && v.startsWith("data:image") && v !== "data:,"

/**
 * Sent to Claro under the old flow: the first send happened but what is
 * stored is a priced invoice (`jaf-invoices/`) or nothing, never the work
 * order PDF the release gate needs. Step 4 can still generate that PDF.
 */
const isSentUnderOldFlow = (doc: {
	jafInvoiceGeneratedAt: Date | null
	jafInvoicePdfPath: string | null
}) => !!doc.jafInvoiceGeneratedAt && !isPacketPath(doc.jafInvoicePdfPath)

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Supervisor Review — JAF Ops`
			: "JAF Ops",
	},
]

/** Money columns on a work order: never sent to a price-blind role. */
const MONEY_COLUMNS = [
	"jafInvoiceLineTotal",
	"avisoLineTotal",
	"advanceAmount",
	"finalPaymentAmount",
	"contractorShareLines",
	"grossPayable",
	"retentionAmount",
	"netPayable",
] as const

/** Lines (invoice, Aviso, pre-cert) with `unitPrice` and `lineAmount` removed. */
function linesWithoutPrices<T>(v: T): T {
	if (!Array.isArray(v)) return v
	return v.map((l) => {
		const { unitPrice: _unitPrice, lineAmount: _lineAmount, ...rest } = l
		return rest
	}) as T
}

/**
 * A price-blind role's copy: the same shape, with every price and amount
 * removed (absent, not zero). Components only read the removed fields when
 * `showPrices` is on.
 */
function withoutPrices<T extends Record<string, unknown>>(doc: T): T {
	const out: Record<string, unknown> = {
		...doc,
		jafInvoiceLines: linesWithoutPrices(doc.jafInvoiceLines),
		avisoLines: linesWithoutPrices(doc.avisoLines),
	}
	for (const k of MONEY_COLUMNS) delete out[k]
	// An old priced JAF invoice (jaf-invoices/) is a price document too.
	if (isLegacyPricedInvoice(doc.jafInvoicePdfPath)) out.jafInvoicePdfPath = null
	return out as T
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { brigade: { select: { area: true } }, claroSupervisor: true },
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const personIds = [
		...new Set([
			...((doc.addressCorrections as AddressCorrection[] | null) ?? []).map(
				(c) => c.correctedById,
			),
			...(doc.completedById ? [doc.completedById] : []),
		]),
	]
	// Step 5 lists the materials the work order PDF prints: every Source, used
	// lines only (the same rows `buildWorkOrderDocument` takes).
	const materialRows = fieldMaterialsOrDefault(
		doc.fieldMaterials,
		(doc.materialsTaken as MaterialLine[] | null) ?? [],
	).filter((r) => r.used > 0)
	const [
		serviceCodes,
		photos,
		supervisor,
		sheet,
		brigade,
		people,
		sends,
		materialCodes,
		claroOptions,
	] = await Promise.all([
		getActiveServiceCodes(),
		db.photo.findMany({ where: { docId: params.id } }),
		db.user.findUnique({
			where: { id: doc.supervisorId },
			select: { name: true },
		}),
		activeSheet(params.id),
		doc.brigadeId
			? db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: Promise.resolve(null),
		db.user.findMany({
			where: { id: { in: personIds } },
			select: { id: true, name: true },
		}),
		db.packetSend.findMany({
			where: { docId: params.id },
			orderBy: { sentAt: "desc" },
			select: {
				id: true,
				sentAt: true,
				recipientEmail: true,
				outcome: true,
				error: true,
				sentBy: { select: { name: true } },
			},
		}),
		materialRows.length > 0
			? db.serviceCode.findMany({
					where: { id: { in: materialRows.map((r) => r.serviceCodeId) } },
					select: { id: true, claroCode: true, name: true, unit: true },
				})
			: Promise.resolve([]),
		// The packet step's Claro supervisor choice, until the first send: the
		// active entries, plus the job's own one even if it was deactivated.
		doc.jafInvoiceGeneratedAt
			? Promise.resolve([])
			: db.claroSupervisor.findMany({
					where: {
						OR: [
							{ active: true },
							...(doc.claroSupervisorId ? [{ id: doc.claroSupervisorId }] : []),
						],
					},
					orderBy: { name: "asc" },
					select: {
						id: true,
						name: true,
						email: true,
						requiresPrefield: true,
						requiresBlueprint: true,
					},
				}),
	])
	const correctorNames = Object.fromEntries(people.map((u) => [u.id, u.name]))
	const stage = deriveSupervisorStage(doc, sheet)
	const { view, interactive } = resolveStepView(
		stage,
		isAvisoStarted(doc),
		new URL(request.url).searchParams.get("step"),
	)
	const gate = evaluateReleaseGate({
		doc,
		sheet,
		photos: await photosThatLoad(params.id, photos),
	})
	const lineTotal =
		doc.jafInvoiceLineTotal != null
			? toNumberPrice(doc.jafInvoiceLineTotal)
			: null
	let invoiceSummary: {
		number: string
		lineTotal: number
		ivuRate: number
		ivu: number
		total: number
		sharePercent: number
		contractor: number
		retentionPercent: number
		contractorNet: number
	} | null = null
	// Supervisors never see money (catalog, totals, brigade share), including
	// on the Aviso card: it still runs the gate, it just hides the price fields.
	const showPrices = showPricesFor(user.role)
	// Step 5 shows the work summary as soon as the supervisor arrives, built
	// from what was installed. Prices are computed here and never sent to a
	// price-blind role.
	const preview: InvoiceLine[] =
		stage === "INVOICE" && !doc.jafInvoiceGeneratedAt
			? buildInvoiceLines(
					(doc.installedServiceLines as ServiceLine[] | null) ?? [],
					Object.fromEntries(serviceCodes.map((c) => [c.id, c])),
				)
			: []
	const invoiceHeader = {
		controlNumber: doc.controlNumber,
		jobType: doc.jobType,
		address: doc.jobAddressActual ?? doc.jobAddressEstimated,
		// The crew as the work order prints it: "NAME · contract number".
		brigadeName: brigade
			? brigade.code
				? `${brigade.name} · ${brigade.code}`
				: brigade.name
			: null,
		workDate: (doc.startedAt ?? doc.fieldSubmittedAt)?.toISOString() ?? null,
	}
	if (lineTotal != null && showPrices) {
		const ivuRate = await getIvuRate()
		const contractor = round2(lineTotal * CONTRACTOR_SHARE_PERCENT)
		invoiceSummary = {
			number: invoiceNumberFor(doc),
			lineTotal,
			ivuRate,
			ivu: round2(lineTotal * ivuRate),
			total: round2(lineTotal + round2(lineTotal * ivuRate)),
			sharePercent: CONTRACTOR_SHARE_PERCENT,
			contractor,
			retentionPercent: RETENTION_RATE,
			contractorNet: round2(contractor - round2(contractor * RETENTION_RATE)),
		}
	}
	// Step 5 · Packet → Claro. "Sent" is the first SENT/MANUAL send
	// (`jafInvoiceGeneratedAt`); a stored PDF alone is not, since an
	// UNCONFIGURED attempt also stores one for the manual path.
	const claro = doc.claroSupervisor
	const sent = doc.jafInvoiceGeneratedAt != null
	const blockers: PacketBlocker[] = sent
		? []
		: claro
			? packetBlockers(doc, claro)
			: ["claro_supervisor"]
	const codeById = new Map(materialCodes.map((c) => [c.id, c]))
	const emailEnabled = isPacketEmailEnabled()
	const packet: PacketStepData = {
		sent,
		sentAt: doc.jafInvoiceGeneratedAt,
		claroSupervisor: claro
			? {
					name: claro.name,
					email: claro.email,
					requiresPrefield: claro.requiresPrefield,
				}
			: null,
		claroSupervisorId: doc.claroSupervisorId,
		claroOptions,
		showPrefield: claro?.requiresPrefield ?? false,
		prefield: {
			avisoNumber: doc.avisoNumber,
			ordenNumber: doc.ordenNumber,
			pedido: doc.pedido,
			smr: doc.smr,
			titulo: doc.titulo,
			description: doc.jobDescription,
		},
		prefieldMissing: claro?.requiresPrefield ? prefieldMissing(doc) : [],
		blockers,
		// Only a real packet: a legacy priced invoice in jaf-invoices/ is not one.
		packetHref: isPacketPath(doc.jafInvoicePdfPath)
			? uploadHref(doc.jafInvoicePdfPath as string)
			: null,
		blueprints: doc.blueprintPaths.map((p) => {
			const name = path.basename(p)
			return {
				name,
				href: `/files/blueprints/${encodeURIComponent(doc.id)}/${encodeURIComponent(name)}`,
			}
		}),
		materials: materialRows.map((r) => {
			const code = codeById.get(r.serviceCodeId)
			return {
				serviceCodeId: r.serviceCodeId,
				claroCode: code?.claroCode ?? "",
				name: code?.name ?? r.serviceCodeId,
				unit: code?.unit ?? null,
				used: r.used,
				returned: r.returned,
				source: r.source,
			}
		}),
		history: sends.map((s) => ({
			id: s.id,
			sentAt: s.sentAt,
			sentBy: s.sentBy?.name ?? "—",
			recipientEmail: s.recipientEmail,
			outcome: s.outcome,
			error: s.error,
		})),
		// The manual path is for a send that never reached Claro: only before
		// the first send, and only after an attempt the server could not deliver.
		// With email off the manual send is the only one: offered whenever the
		// step 4 PDF exists and nothing was sent yet.
		emailEnabled,
		canMarkManual: emailEnabled
			? !sent &&
				(sends[0]?.outcome === "UNCONFIGURED" || sends[0]?.outcome === "FAILED")
			: !sent && isPacketPath(doc.jafInvoicePdfPath),
	}

	// Step 4 · the work order document, and Generate PDF: open once the
	// supervisor has signed and the Claro supervisor's rules are met, until the
	// first send to Claro locks it. A job sent under the old flow has no work
	// order PDF yet, so it stays open for it until the release.
	const workOrder =
		panelForStep(view) === "APPROVE"
			? await loadWorkOrderDocument(params.id, "urls", user.name)
			: null
	const canGeneratePdf =
		!!doc.supervisorApprovedAt &&
		!doc.releasedToFinanceAt &&
		!isTerminalStatus(doc.status) &&
		(isSentUnderOldFlow(doc) ||
			(isSig(doc.completionSignature) &&
				!doc.jafInvoiceGeneratedAt &&
				blockers.length === 0))

	const { claroSupervisor: _claro, ...docData } = doc
	return {
		doc: showPrices ? docData : withoutPrices(docData),
		user,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		photos,
		supervisor,
		sheet:
			sheet && !showPrices
				? (() => {
						const { total: _total, ...rest } = sheet
						return {
							...rest,
							lines: linesWithoutPrices(sheet.lines),
						} as typeof sheet
					})()
				: sheet,
		brigade,
		stage,
		openLabel: openJobLabel(doc, sheet),
		view,
		interactive,
		gate,
		invoiceSummary,
		invoicePreview: showPrices ? preview : linesWithoutPrices(preview),
		invoiceHeader,
		showPrices,
		correctorNames,
		packet,
		workOrder,
		workOrderIssuedOn: (doc.completionSignedAt ?? new Date()).toISOString(),
		canGeneratePdf,
		// Who signed off (Step 4). Before this redesign it was the crew lead.
		signedOffBy: doc.completedById
			? (correctorNames[doc.completedById] ?? null)
			: null,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { brigade: { select: { area: true } }, claroSupervisor: true },
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "approve") {
		if (!canTransition(doc.status, "SUPERVISOR_APPROVED", user.role))
			throw redirect(`/docs/${params.id}`)
		// Sign off: the supervisor signs the field completion (name and date
		// are their login and now). It locks the Field step for them.
		const signature = form.get("completionSignature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		if (ordered.length > 0 && installed.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }
		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || doc.avisoNumber
		const claroNotes = (form.get("claroNotes") as string | null)?.trim() || null
		const now = new Date()
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: now,
					completionSignature: signature as string,
					completedById: user.id,
					completionSignedAt: now,
					avisoNumber,
					claroNotes,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: doc.status, after: "SUPERVISOR_APPROVED" },
					},
				},
			}),
		])
		// Signed: stay on step 4, where Generate PDF is now open.
		throw redirect(`/docs/${params.id}/review?step=APPROVE`)
	}

	// Step 4 · Generate PDF: render the work order document and store it as
	// the job's packet PDF. Only after sign-off (a missing warehouse or crew
	// signature prints "Pending" and never blocks), and only until the first
	// send to Claro: regenerating before then replaces the stored file. A job
	// sent under the old flow (a priced invoice, or nothing, stored) has no
	// work order PDF for the release gate, so it may generate one until the
	// release; the Claro supervisor's rules stopped applying at its send.
	if (intent === "generate_work_order_pdf") {
		const oldFlow = isSentUnderOldFlow(doc)
		if (
			(doc.jafInvoiceGeneratedAt && !oldFlow) ||
			doc.releasedToFinanceAt ||
			isTerminalStatus(doc.status)
		)
			return { errorKey: "packet.errors.locked" }
		if (
			!doc.supervisorApprovedAt ||
			(!oldFlow && !isSig(doc.completionSignature))
		)
			return { errorKey: "packet.errors.not_signed_off" }
		if (!oldFlow) {
			const claro = doc.claroSupervisor
			if (!claro) return { errorKey: "packet.errors.no_claro_supervisor" }
			const blockers = packetBlockers(doc, claro)
			if (blockers.includes("prefield"))
				return { errorKey: "packet.errors.prefield_missing" }
			if (blockers.includes("blueprint"))
				return { errorKey: "packet.errors.blueprint_missing" }
		}
		let pdfPath: string
		// The layout of this file, so the send that records it can say so.
		let showPrefield: boolean
		try {
			const input = await buildPacketInput(params.id)
			showPrefield = input.document.prefield !== "not_required"
			const pdf = await generateClaroPacketPdf(input)
			pdfPath = await saveBuffer(
				"packets",
				`${params.id}-work-order-${Date.now()}.pdf`,
				pdf,
			)
		} catch {
			return { errorKey: "packet.errors.render_failed" }
		}
		const stored = await db.$transaction(async (tx) => {
			// A send that landed while rendering wins: nothing changes. An
			// old-flow job only checks nobody stored another file meanwhile.
			const updated = await tx.jafInvoice.updateMany({
				where: oldFlow
					? { id: params.id, jafInvoicePdfPath: doc.jafInvoicePdfPath }
					: { id: params.id, jafInvoiceGeneratedAt: null },
				data: { jafInvoicePdfPath: pdfPath },
			})
			if (updated.count === 0) return false
			await tx.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "WORK_ORDER_PDF_GENERATED",
					diffJson: {
						jafInvoicePdfPath: {
							before: doc.jafInvoicePdfPath,
							after: pdfPath,
						},
						showPrefield,
					},
				},
			})
			return true
		})
		if (!stored) return { errorKey: "packet.errors.locked" }
		throw redirect(`/docs/${params.id}/review?step=APPROVE`)
	}

	if (intent === "upload_claro") {
		if (!canTransition(doc.status, "CLARO_UPLOADED", user.role))
			throw redirect(`/docs/${params.id}`)
		const claroPdf = form.get("claroPdf") as File
		if (!claroPdf || claroPdf.size === 0)
			return { errorKey: "docs_review.errors.pdf_required" }
		const validation = validateFile(claroPdf, "pdf")
		if (!validation.valid) return { errorMessage: validation.error }
		const localPath = await saveUpload(
			"claro-pdfs",
			`${params.id}-claro.pdf`,
			claroPdf,
		)
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "CLARO_UPLOADED",
					claroPdfPath: localPath,
					claroUploadedAt: new Date(),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: "SUPERVISOR_APPROVED", after: "CLARO_UPLOADED" },
					},
				},
			}),
			...finance.map((f) =>
				db.notification.create({
					data: {
						userId: f.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} Claro work order uploaded. Ready for LC request.`,
					},
				}),
			),
		])
	}

	// Step 5 · Packet → Claro: email the packet, or record that the
	// supervisor sent the downloaded PDF themselves. `sendPacket` owns the gates
	// (sign-off, Claro supervisor, Prefield / blueprint), the send log and the
	// first-send lock; every outcome lands back on the step, whose history and
	// banner say what happened.
	if (intent === "send_packet" || intent === "mark_packet_sent") {
		const result = await sendPacket({
			docId: params.id,
			actor: { id: user.id, role: user.role, name: user.name },
			mode: intent === "send_packet" ? "email" : "manual",
		})
		if (!result.ok) return { errorKey: result.errorKey }
		throw redirect(`/docs/${params.id}/review`)
	}

	// Step 5 · the Prefield fields, the Claro supervisor and (when that
	// supervisor needs one) a blueprint can be filled or corrected here until
	// the first send; after it they are what Claro received. Any change makes
	// the stored PDF out of date, so it is cleared and step 4 generates it again.
	if (intent === "save_prefield") {
		if (doc.jafInvoiceGeneratedAt)
			return { errorKey: "packet.errors.prefield_locked" }
		if (doc.releasedToFinanceAt || isTerminalStatus(doc.status))
			return { errorKey: "packet.errors.locked" }
		const text = (k: string) =>
			((form.get(k) as string | null) ?? "").trim() || null
		const data: Prisma.JafInvoiceUncheckedUpdateInput = {}
		const changes: Record<string, { before: unknown; after: unknown }> = {}
		for (const k of PREFIELD_INPUTS) {
			if (!form.has(k)) continue
			const after = text(k)
			if (after !== doc[k]) {
				data[k] = after
				changes[k] = { before: doc[k], after }
			}
		}
		const claroId = text("claroSupervisorId")
		if (claroId && claroId !== doc.claroSupervisorId) {
			const claro = await db.claroSupervisor.findUnique({
				where: { id: claroId },
				select: { active: true },
			})
			if (!claro?.active)
				return { errorKey: "packet.errors.claro_supervisor_invalid" }
			data.claroSupervisorId = claroId
			changes.claroSupervisorId = {
				before: doc.claroSupervisorId,
				after: claroId,
			}
		}
		const blueprints = form
			.getAll("blueprint")
			.filter((f): f is File => f instanceof File && f.size > 0)
		if (blueprints.some((f) => !validateBlueprintFile(f).valid))
			return { errorKey: "docs_field.errors.blueprint_invalid" }
		const added: string[] = []
		for (const [i, file] of blueprints.entries())
			added.push(
				await saveUpload(
					`blueprints/${params.id}`,
					uploadFileName(file, i),
					file,
				),
			)
		if (added.length > 0)
			data.blueprintPaths = [...doc.blueprintPaths, ...added]
		if (Object.keys(data).length > 0 && doc.jafInvoicePdfPath) {
			data.jafInvoicePdfPath = null
			changes.jafInvoicePdfPath = { before: doc.jafInvoicePdfPath, after: null }
		}
		if (Object.keys(data).length > 0)
			await db.$transaction([
				db.jafInvoice.update({ where: { id: params.id }, data }),
				db.auditTrail.create({
					data: {
						docId: params.id,
						userId: user.id,
						action: "PREFIELD_EDITED",
						diffJson: {
							...changes,
							...(added.length > 0 ? { blueprintsAdded: added.length } : {}),
						} as Prisma.InputJsonValue,
					},
				}),
			])
		throw redirect(`/docs/${params.id}/review`)
	}

	// Something is wrong with what the brigade reported: reopen the Approve step
	// (not the crew) so the supervisor can fix it before anything goes to Claro.
	// The stored PDF no longer matches what will be signed: it is cleared.
	if (intent === "back_to_approve") {
		const note = (form.get("note") as string | null)?.trim() || ""
		if (!note) return { errorKey: "docs_review.errors.back_note_required" }
		if (
			doc.status !== "SUPERVISOR_APPROVED" ||
			!doc.supervisorApprovedAt ||
			doc.jafInvoiceGeneratedAt
		)
			throw redirect(`/docs/${params.id}/review`)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "FIELD_UPDATED",
					supervisorApprovedAt: null,
					...(doc.jafInvoicePdfPath ? { jafInvoicePdfPath: null } : {}),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "BACK_TO_APPROVE",
					diffJson: {
						status: { before: doc.status, after: "FIELD_UPDATED" },
						note,
						...(doc.jafInvoicePdfPath
							? {
									jafInvoicePdfPath: {
										before: doc.jafInvoicePdfPath,
										after: null,
									},
								}
							: {}),
					},
				},
			}),
		])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "save_aviso") {
		// Step 6 (spec F2): the only check is that the number on the file equals
		// the typed one. Rows, quantities and amounts are never compared.
		if (!doc.jafInvoiceGeneratedAt)
			return { errorKey: "docs_review.errors.invoice_required" }
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)

		const typed = (form.get("avisoNumber") as string | null)?.trim() || null
		if (!typed) return { errorKey: "docs_review.errors.aviso_number_required" }

		const avisoPdf = form.get("avisoPdf")
		const newFile =
			avisoPdf instanceof File && avisoPdf.size > 0 ? avisoPdf : null
		let pdfBytes: Uint8Array
		if (newFile) {
			const validation = validateFile(newFile, "pdf")
			if (!validation.valid) return { errorMessage: validation.error }
			pdfBytes = new Uint8Array(await newFile.arrayBuffer())
		} else {
			// No new file: the number is re-checked against the file on record.
			const onRecord = doc.avisoDocPath ? await readPdf(doc.avisoDocPath) : null
			if (!onRecord)
				return { errorKey: "docs_review.errors.aviso_pdf_required" }
			pdfBytes = onRecord
		}
		const checked = await checkAvisoNumber(typed, pdfBytes)
		if ("errorKey" in checked)
			return {
				errorKey: checked.errorKey,
				typedNumber: checked.typedNumber,
				pdfAvisoNumber: checked.pdfAvisoNumber,
			}
		const { avisoNumber } = checked

		// The pre-cert sheet comes from what the crew installed: refuse before
		// writing anything if there is nothing to certify.
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		if ((await preCertLinesFor(installed)).lines.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }

		// A new file or number regenerates the sheet; a signed one is kept as is.
		const sheet = await activeSheet(params.id)
		const changed = !!newFile || avisoNumber !== doc.avisoNumber
		const keepSigned = !!sheet && changed && isSheetSigned(sheet)
		const generate = !sheet || (changed && !keepSigned)

		// Everything validated: only now write the PDF to disk.
		const avisoDocPath = newFile
			? await saveUpload("aviso-docs", `${params.id}-aviso.pdf`, newFile)
			: doc.avisoDocPath
		const transition = canTransition(doc.status, "CLARO_UPLOADED", user.role)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					avisoNumber,
					avisoDocPath,
					...(transition
						? { status: "CLARO_UPLOADED", claroUploadedAt: new Date() }
						: {}),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_CAPTURED",
					diffJson: { avisoNumber, fileUploaded: !!newFile },
				},
			}),
			...(transition
				? [
						db.auditTrail.create({
							data: {
								docId: params.id,
								userId: user.id,
								action: "STATUS_CHANGED",
								diffJson: {
									status: { before: doc.status, after: "CLARO_UPLOADED" },
								},
							},
						}),
					]
				: []),
		])
		if (generate)
			await createPreCertSheet({
				docId: params.id,
				actor: { id: user.id, role: user.role },
			})
		if (keepSigned) return { noteKey: "docs_review.aviso_resaved_signed" }
		throw redirect(`/docs/${params.id}/review`)
	}

	// Manual fallback: the sheet is generated on Aviso save, but a failed render
	// (or an explicit regenerate on the sheet) can still create the next version.
	if (intent === "generate_precert") {
		if (!isAvisoSaved(doc))
			return { errorKey: "docs_review.errors.aviso_pdf_required" }
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		if ((await preCertLinesFor(installed)).lines.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }
		await createPreCertSheet({
			docId: params.id,
			actor: { id: user.id, role: user.role },
		})
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "edit_precert_qty") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		if (sheet.sigSupervisorAt)
			return { errorKey: "docs_review.errors.precert_locked" }
		const reason = (form.get("reason") as string | null)?.trim() || ""
		if (!reason)
			return { errorKey: "docs_review.errors.precert_edit_reason_required" }
		const serviceCodeId = form.get("serviceCodeId") as string
		const certifiedQty = Math.max(
			0,
			Number.parseInt((form.get("certifiedQty") as string) || "0", 10) || 0,
		)
		const lines = (sheet.lines as PreCertLine[]).map((l) =>
			l.serviceCodeId === serviceCodeId
				? {
						...l,
						certifiedQty,
						editReason: reason,
						lineAmount: round2(certifiedQty * l.unitPrice),
					}
				: l,
		)
		const total = sumLines(lines)
		const pdfPath = await renderPreCert(
			{ ...sheet, lines, total } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { lines, total, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_QTY_EDITED",
					diffJson: { serviceCodeId, certifiedQty, reason },
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_supervisor") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		const data = {
			sigSupervisorUserId: user.id,
			sigSupervisorName: user.name,
			sigSupervisorImage: signature as string,
			sigSupervisorAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: { role: "SUPERVISOR", version: sheet.version },
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_subcontractor") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null
		const typedCode =
			(form.get("contractorCode") as string | null)?.trim() || null
		const code = brigade?.code ?? typedCode
		if (!code)
			return { errorKey: "docs_review.errors.contractor_code_required" }
		const signerName =
			(form.get("signerName") as string | null)?.trim() ||
			brigade?.leadName ||
			brigade?.name ||
			""
		if (brigade && !brigade.code)
			await db.brigade.update({ where: { id: brigade.id }, data: { code } })
		const data = {
			sigSubcontractorCode: code,
			sigSubcontractorName: signerName,
			sigSubcontractorImage: signature as string,
			sigSubcontractorAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.jafInvoice.update({
				where: { id: params.id },
				data: { contractorAccountCode: code },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: {
						role: "SUBCONTRACTOR",
						code,
						signerName,
						version: sheet.version,
					},
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_claro") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		const scan = form.get("scan")
		const signerName = (form.get("signerName") as string | null)?.trim() || null
		let sigClaroScanPath: string | null = null
		if (scan instanceof File && scan.size > 0) {
			const v = validateFile(scan, "file")
			if (!v.valid) return { errorMessage: v.error }
			const ext = scan.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ".jpg"
			sigClaroScanPath = await saveUpload(
				"precert",
				`${params.id}-claro-scan${ext}`,
				scan,
			)
		}
		if (!isSig(signature) && !sigClaroScanPath)
			return { errorKey: "docs_review.errors.signature_required" }
		const data = {
			sigClaroName: signerName,
			sigClaroImage: isSig(signature) ? (signature as string) : null,
			sigClaroScanPath,
			sigClaroAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: {
						role: "CLARO",
						scanned: !!sigClaroScanPath,
						version: sheet.version,
					},
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "release_to_finance") {
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)
		const [sheet, photos] = await Promise.all([
			activeSheet(params.id),
			db.photo.findMany({
				where: { docId: params.id },
				select: { tag: true, localPath: true },
			}),
		])
		const gate = evaluateReleaseGate({
			doc,
			sheet,
			photos: await photosThatLoad(params.id, photos),
		})
		if (!gate.ok)
			return {
				errorKey: "docs_review.errors.release_blocked",
				rows: gate.rows,
			}
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null
		const contractor =
			sheet?.sigSubcontractorName ?? brigade?.leadName ?? brigade?.name ?? ""
		// No amount in the message: supervisors can read their own notifications
		// back, and they never see money.
		const message = `${doc.controlNumber} · Aviso ${doc.avisoNumber} · ${contractor} — ready for payment request`
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					releasedToFinanceAt: new Date(),
					releasedToFinanceById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "RELEASED_TO_FINANCE",
					diffJson: { rows: gate.rows },
				},
			}),
			...finance.map((f) =>
				db.notification.create({
					data: { userId: f.id, docId: params.id, message },
				}),
			),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "edit_aviso") {
		// PRD §1.5: supervisor can enter/update the Aviso # at any point. Once an
		// Aviso PDF is on record, only the number on that file is accepted.
		let avisoNumber = (form.get("avisoNumber") as string | null)?.trim() || null
		if (doc.avisoDocPath) {
			if (!avisoNumber)
				return { errorKey: "docs_review.errors.aviso_number_required" }
			const onRecord = await readPdf(doc.avisoDocPath)
			if (!onRecord)
				return { errorKey: "docs_review.errors.aviso_pdf_required" }
			const checked = await checkAvisoNumber(avisoNumber, onRecord)
			if ("errorKey" in checked)
				return {
					errorKey: checked.errorKey,
					typedNumber: checked.typedNumber,
					pdfAvisoNumber: checked.pdfAvisoNumber,
				}
			avisoNumber = checked.avisoNumber
		}
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { avisoNumber },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_NUMBER_SET",
					diffJson: { avisoNumber },
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	throw redirect(`/docs/${params.id}`)
}

const RELEASE_ROW_KEYS = {
	work_order_pdf: "release.row.work_order_pdf",
	aviso: "release.row.aviso",
	precert_signed: "release.row.precert_signed",
	photos: "release.row.photos",
} as const

function SignatureBlock({
	intent,
	labelKey,
	children,
	signed,
	optional = false,
	encType,
	readOnly = false,
	fieldName = "signature",
	submitLabelKey = "precert.sign",
}: {
	intent: string
	labelKey: ParseKeys
	/** The form field the drawn signature is posted as. */
	fieldName?: string
	submitLabelKey?: ParseKeys
	/** Fields above the pad (name, contractor code, scan upload). */
	children?: React.ReactNode
	/** Present once this party has signed: replaces the form with a summary. */
	signed?: React.ReactNode
	optional?: boolean
	encType?: "multipart/form-data"
	readOnly?: boolean
}) {
	const { t } = useTranslation()
	const padRef = useRef<SignaturePadHandle>(null)
	const [cleared, setCleared] = useState(0)
	const header = (
		<div className="flex items-start justify-between gap-2">
			<p className="text-sm font-medium">{t(labelKey)}</p>
			{signed ? (
				<span className="shrink-0 rounded-full bg-status-ok-soft px-2 py-0.5 text-xs font-medium text-status-ok">
					✓ {t("precert.signed")}
				</span>
			) : (
				<span className="text-xs text-muted-foreground">
					{optional ? t("precert.optional") : t("precert.required")}
				</span>
			)}
		</div>
	)
	const box = "flex-1 min-w-[14rem] border rounded-lg p-3 space-y-3"
	if (signed || readOnly) {
		return (
			<div className={box}>
				{header}
				{signed ?? (
					<p className="text-xs text-muted-foreground">
						{t("precert.not_captured")}
					</p>
				)}
			</div>
		)
	}
	return (
		<Form
			method="post"
			encType={encType}
			className={box}
			onSubmit={(e) => {
				const pad = padRef.current
				const form = e.currentTarget
				const input = form.elements.namedItem(
					fieldName,
				) as HTMLInputElement | null
				const scan = form.elements.namedItem("scan") as HTMLInputElement | null
				const hasScan = !!scan?.files?.length
				if ((!pad || pad.isEmpty()) && !hasScan) {
					e.preventDefault()
				} else if (input && pad && !pad.isEmpty()) {
					input.value = pad.toDataURL()
				}
			}}
		>
			<input type="hidden" name="intent" value={intent} />
			<input type="hidden" name={fieldName} />
			{header}
			{children}
			<div className="space-y-1">
				<SignaturePad
					key={cleared}
					ref={padRef}
					width={280}
					height={90}
					className="w-full border rounded bg-card"
				/>
				<p className="text-xs text-muted-foreground">
					{t("precert.sign_here")}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setCleared((c) => c + 1)}
				>
					{t("precert.clear_signature")}
				</Button>
				<Button type="submit" size="sm" className="ml-auto">
					{t(submitLabelKey)}
				</Button>
			</div>
		</Form>
	)
}

/**
 * Step 4 · Sign off (was Approve): the supervisor signs the field completion
 * with their name and the date. No send-back to crew; once signed, Field is
 * locked for the supervisor.
 */
function SignOffCard({
	doc,
	signerName,
	signedOffBy,
	canSign,
	errorKey,
}: {
	doc: {
		supervisorApprovedAt: Date | string | null
		completionSignature: string | null
		completionSignedAt: Date | string | null
	}
	signerName: string
	signedOffBy: string | null
	canSign: boolean
	errorKey?: string
}) {
	const { t } = useTranslation()
	const signed = !!doc.supervisorApprovedAt && !!doc.completionSignature
	return (
		<Card>
			<CardHeader>{t("docs_review.signoff_heading")}</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-xs text-muted-foreground">
					{t("docs_review.signoff_hint")}
				</p>
				<SignatureBlock
					intent="approve"
					fieldName="completionSignature"
					labelKey="docs_review.approve"
					submitLabelKey="docs_review.approve_field_work"
					readOnly={!canSign}
					signed={
						signed ? (
							<div className="space-y-1">
								<img
									src={doc.completionSignature ?? ""}
									alt=""
									className="h-12 rounded border bg-card"
								/>
								<p className="text-xs text-muted-foreground">
									{t("docs_review.signed_off_by", {
										name: signedOffBy ?? "—",
										when: doc.completionSignedAt
											? new Date(doc.completionSignedAt).toLocaleString()
											: "",
									})}
								</p>
							</div>
						) : undefined
					}
				>
					<dl className="grid grid-cols-2 gap-2 text-sm">
						<div>
							<dt className="text-xs text-muted-foreground">
								{t("docs_review.signoff_name")}
							</dt>
							<dd className="font-medium">{signerName}</dd>
						</div>
						<div>
							<dt className="text-xs text-muted-foreground">
								{t("docs_review.signoff_date")}
							</dt>
							<dd className="font-medium" suppressHydrationWarning>
								{new Date().toLocaleDateString()}
							</dd>
						</div>
					</dl>
				</SignatureBlock>
				{canSign && errorKey && (
					<p role="alert" className="text-sm text-status-danger">
						{t(errorKey as ParseKeys)}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

function PreCertPanel({
	sheet,
	doc,
	brigade,
	error,
	readOnly = false,
	showPrices,
}: {
	readOnly?: boolean
	showPrices: boolean
	sheet: Route.ComponentProps["loaderData"]["sheet"]
	doc: Route.ComponentProps["loaderData"]["doc"]
	brigade: Route.ComponentProps["loaderData"]["brigade"]
	error: { errorKey?: string; errorMessage?: string } | null
}) {
	const { t } = useTranslation()
	const lines = (sheet?.lines as PreCertLine[] | null) ?? []
	const locked = !!sheet?.sigSupervisorAt
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="font-medium">
					{t("precert.version", { n: sheet?.version ?? 1 })}
				</span>
				{sheet?.pdfPath && (
					<a
						href={`/files/precert/${doc.id}-v${sheet.version}.pdf`}
						className="text-accent-text underline"
					>
						{t("precert.download")}
					</a>
				)}
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b">
						<th className="py-1">{t("service_picker.col_code")}</th>
						<th className="py-1">{t("service_picker.col_description")}</th>
						<th className="py-1">{t("service_picker.col_type")}</th>
						<th className="py-1 text-right">
							{t("service_picker.col_installed")}
						</th>
						<th className="py-1 text-right">{t("precert.col_qty")}</th>
						{showPrices && (
							<th className="py-1 text-right">{t("precert.col_cost")}</th>
						)}
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => (
						<tr key={l.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1">
								{splitServiceSuffix(l.description).base}
								{l.editReason && (
									<span className="block text-xs text-status-warn">
										{l.editReason}
									</span>
								)}
							</td>
							<td className="py-1 font-mono text-xs">
								{splitServiceSuffix(l.description).suffix ?? "—"}
							</td>
							<td className="py-1 text-right">{l.installedQty}</td>
							<td className="py-1 text-right">{l.certifiedQty}</td>
							{showPrices && (
								<td className="py-1 text-right">${l.lineAmount.toFixed(2)}</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
			{showPrices && (
				<p className="text-sm text-right font-medium">
					{t("precert.total")} {formatMoney(sumLines(lines))}
				</p>
			)}
			{!readOnly &&
				!locked &&
				lines.map((l) => (
					<Form
						key={l.serviceCodeId}
						method="post"
						className="flex flex-wrap items-center gap-2 text-xs"
					>
						<input type="hidden" name="intent" value="edit_precert_qty" />
						<input type="hidden" name="serviceCodeId" value={l.serviceCodeId} />
						<span className="font-mono">{l.claroCode}</span>
						<Input
							name="certifiedQty"
							type="number"
							min={0}
							defaultValue={l.certifiedQty}
							className="w-20"
						/>
						<Input
							name="reason"
							placeholder={t("precert.reason_placeholder")}
							className="flex-1 min-w-[10rem]"
							required
						/>
						<Button type="submit" size="sm" variant="outline">
							{t("precert.save_qty")}
						</Button>
					</Form>
				))}
			<div className="space-y-2 pt-1">
				<h3 className="text-sm font-medium">{t("precert.signatures")}</h3>
				{!readOnly && (
					<p className="text-xs text-muted-foreground">
						{t("precert.signatures_hint")}
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-3">
				<SignatureBlock
					intent="sign_precert_supervisor"
					labelKey="precert.sig_supervisor"
					readOnly={readOnly}
					signed={
						sheet?.sigSupervisorName ? (
							<div className="space-y-1">
								{sheet.sigSupervisorImage && (
									<img
										src={sheet.sigSupervisorImage}
										alt=""
										className="h-12 rounded border bg-card"
									/>
								)}
								<p className="text-sm">{sheet.sigSupervisorName}</p>
								<p className="text-xs text-muted-foreground">
									{sheet.sigSupervisorAt
										? new Date(sheet.sigSupervisorAt).toLocaleDateString()
										: ""}
								</p>
							</div>
						) : undefined
					}
				/>
				<SignatureBlock
					intent="sign_precert_subcontractor"
					labelKey="precert.sig_subcontractor"
					readOnly={readOnly}
					signed={
						sheet?.sigSubcontractorName ? (
							<div className="space-y-1">
								{sheet.sigSubcontractorImage && (
									<img
										src={sheet.sigSubcontractorImage}
										alt=""
										className="h-12 rounded border bg-card"
									/>
								)}
								<p className="text-sm">
									{sheet.sigSubcontractorName} · {sheet.sigSubcontractorCode}
								</p>
							</div>
						) : undefined
					}
				>
					<Input
						name="signerName"
						aria-label={t("precert.signer_name")}
						placeholder={t("precert.signer_name")}
						defaultValue={brigade?.leadName ?? ""}
					/>
					{!brigade?.code && (
						<Input
							name="contractorCode"
							placeholder={t("precert.contractor_code")}
							required
						/>
					)}
				</SignatureBlock>
				<SignatureBlock
					intent="sign_precert_claro"
					labelKey="precert.sig_claro"
					encType="multipart/form-data"
					optional
					readOnly={readOnly}
					signed={
						sheet?.sigClaroAt ? (
							<div className="space-y-1">
								{sheet.sigClaroImage && (
									<img
										src={sheet.sigClaroImage}
										alt=""
										className="h-12 rounded border bg-card"
									/>
								)}
								{sheet.sigClaroScanPath && (
									<a
										href={`/files/precert/${doc.id}-claro-scan.jpg`}
										className="text-accent-text underline text-xs"
									>
										{t("precert.download")}
									</a>
								)}
								<p className="text-sm">{sheet.sigClaroName}</p>
							</div>
						) : undefined
					}
				>
					<p className="text-xs text-muted-foreground">
						{t("precert.claro_optional")}
					</p>
					<Input
						name="signerName"
						aria-label={t("precert.signer_name")}
						placeholder={t("precert.signer_name")}
					/>
					<Input
						type="file"
						name="scan"
						accept="image/*,application/pdf"
						aria-label={t("precert.upload_scan")}
						className="h-auto py-1.5 text-xs"
					/>
				</SignatureBlock>
			</div>
			{error?.errorKey ? (
				<p className="text-sm text-status-danger">
					{t(error.errorKey as ParseKeys)}
				</p>
			) : error?.errorMessage ? (
				<p className="text-sm text-status-danger">{error.errorMessage}</p>
			) : null}
			{!readOnly && !doc.releasedToFinanceAt && (
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
					<Form
						method="post"
						onSubmit={(e) => {
							if (locked && !window.confirm(t("precert.regenerate_confirm")))
								e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="generate_precert" />
						<Button type="submit" variant="ghost" size="sm">
							{t("precert.regenerate")}
						</Button>
						<p className="text-xs text-muted-foreground">
							{t("precert.regenerate_hint")}
						</p>
					</Form>
					<p className="max-w-xs text-right text-xs text-muted-foreground">
						{t("precert.continue_hint")}
					</p>
				</div>
			)}
			{readOnly && sheet?.sigSupervisorAt && sheet?.sigSubcontractorAt && (
				<div className="flex justify-end border-t pt-3">
					<Link to="?step=RELEASE" className={buttonVariants({})}>
						{t("precert.continue_release")}
					</Link>
				</div>
			)}
		</div>
	)
}

export default function ReviewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		user,
		photos,
		supervisor,
		sheet,
		brigade,
		stage,
		openLabel,
		view,
		interactive,
		gate,
		invoiceHeader,
		showPrices,
		packet,
		workOrder,
		workOrderIssuedOn,
		canGeneratePdf,
		signedOffBy,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as
		| {
				errorKey?: string
				errorMessage?: string
				noteKey?: string
				typedNumber?: string
				pdfAvisoNumber?: string
				rows?: { key: string; ok: boolean }[]
		  }
		| undefined
	// Basenames for photos; plain string split because `node:path` is not available in the client bundle
	const photoItems = photos.map((p) => ({
		id: p.id,
		basename: p.localPath.split(/[\\/]/).pop() ?? p.localPath,
		tag: p.tag,
		takenAt: String(p.takenAt),
	}))
	const panel = panelForStep(view)
	// Signed, not sent, but the Claro supervisor's rules block Generate PDF:
	// step 4 says what to fix on step 5.
	const pdfBlocked =
		!!doc.supervisorApprovedAt && !packet.sent && packet.blockers.length > 0
	// Step 4 stays actionable after signing, for Generate PDF, until the send.
	const signOffOpen =
		view === "APPROVE" && (stage === "APPROVE" || canGeneratePdf || pdfBlocked)
	// The one-line "Step N of 9" callout under the rail. Approve only shows while
	// it is the live step; later screens show it whenever they can be acted on.
	const calloutKey =
		view === "APPROVE"
			? signOffOpen
				? "approve"
				: null
			: interactive &&
					(view === "INVOICE" ||
						view === "AVISO" ||
						view === "PRECERT" ||
						view === "RELEASE")
				? (view.toLowerCase() as "invoice" | "aviso" | "precert" | "release")
				: null

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h1 className="font-mono text-xl font-semibold">{doc.controlNumber}</h1>
				<DocStageBadge
					stage={stage}
					openLabel={openLabel}
					cancelled={doc.status === "CANCELLED"}
				/>
			</div>
			<p className="text-sm text-muted-foreground">
				{doc.jobType}
				{doc.fieldSubmittedAt &&
					` · ${new Date(doc.fieldSubmittedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`}
			</p>
			<SupervisorStepRail stage={stage} view={view} docId={doc.id} />
			{!interactive && !signOffOpen && (
				<Pill variant="info" icon="🔒">
					<b>{t("docs_review.readonly_title")}</b>{" "}
					{t("docs_review.readonly_body")}{" "}
					<Link to="." className="underline">
						{t("docs_review.readonly_back")}
					</Link>
					{" · "}
					<Link to={`/docs/${doc.id}`} className="underline">
						{t("docs_review.readonly_work_order")}
					</Link>
				</Pill>
			)}
			{calloutKey && (
				<Callout
					title={t(`docs_review.callout_${calloutKey}_title`, {
						n: SUPERVISOR_STAGES.indexOf(view) + 1,
						total: SUPERVISOR_STAGES.length,
					})}
				>
					{t(`docs_review.callout_${calloutKey}_body`)}
				</Callout>
			)}

			{/* A — Approve */}
			{panel === "APPROVE" && (
				<>
					{workOrder && (
						<WorkOrderDocumentCard
							document={workOrder}
							issuedOn={workOrderIssuedOn}
						/>
					)}
					<SignOffCard
						doc={doc}
						signerName={user.name}
						signedOffBy={signedOffBy}
						canSign={interactive && doc.status === "FIELD_UPDATED"}
						errorKey={error?.errorKey}
					/>
					{signOffOpen && pdfBlocked && (
						<Pill variant="warn" icon="⚠">
							<b>{t("work_order_doc.blockers_title")}</b>
							<ul className="mt-1 list-disc pl-5">
								{packet.blockers.map((b) => (
									<li key={b}>
										{b === "prefield"
											? t("work_order_doc.blocker.prefield", {
													fields: packet.prefieldMissing
														.map((k) =>
															t(
																`packet.prefield.${k as (typeof PREFIELD_INPUTS)[number]}`,
															),
														)
														.join(", "),
												})
											: t(`work_order_doc.blocker.${b}`)}
									</li>
								))}
							</ul>
							<Link to="?step=INVOICE" className="underline">
								{t("work_order_doc.blockers_fix")}
							</Link>
						</Pill>
					)}
					{signOffOpen && (
						<GenerateWorkOrderPdf
							enabled={canGeneratePdf}
							pdfHref={packet.packetHref}
						/>
					)}
					{signOffOpen && error?.errorKey?.startsWith("packet.errors.") && (
						<p role="alert" className="text-sm text-status-danger">
							{t(error.errorKey as ParseKeys)}
						</p>
					)}
					{interactive && stage === "APPROVE" && (
						<Link
							to={`/docs/${doc.id}/field`}
							className={buttonVariants({
								variant: "ghost",
								className: "w-full",
							})}
						>
							← {t("work_order_doc.back_to_field")}
						</Link>
					)}
				</>
			)}

			{/* B — Packet → Claro */}
			{panel === "INVOICE" && (
				<>
					<PhotosCard docId={doc.id} photos={photoItems} />
					<PacketStepCard
						packet={packet}
						interactive={interactive}
						errorKey={error?.errorKey}
					/>
					{interactive && packet.sent && !isAvisoSaved(doc) && (
						<Pill variant="warn" icon="→">
							<b>{t("docs_review_steps.next_aviso_title")}</b>{" "}
							{t("docs_review_steps.next_aviso_body")}
						</Pill>
					)}
					{interactive && stage === "AVISO" && (
						<Link
							to="?step=AVISO"
							className={buttonVariants({ className: "w-full" })}
						>
							{t("docs_review_steps.continue_to_aviso")}
						</Link>
					)}
				</>
			)}

			{/* C — Aviso (step 6) */}
			{panel === "AVISO" && doc.jafInvoiceGeneratedAt && (
				<AvisoCard
					docId={doc.id}
					avisoNumber={doc.avisoNumber}
					avisoDocPath={doc.avisoDocPath}
					saved={isAvisoSaved(doc)}
					locked={!!doc.releasedToFinanceAt}
					readOnly={!interactive}
					result={error ?? null}
				>
					{interactive && doc.status === "SUPERVISOR_APPROVED" && (
						<details className="pt-3">
							<summary className="cursor-pointer text-xs text-muted-foreground">
								{t("docs_review_steps.claro_pdf_optional")}
							</summary>
							<Form
								method="post"
								encType="multipart/form-data"
								className="space-y-2 pt-2"
							>
								<input type="hidden" name="intent" value="upload_claro" />
								<Input
									type="file"
									name="claroPdf"
									accept="application/pdf"
									required
								/>
								<Button type="submit" variant="outline" size="sm">
									{t("docs_review.upload_pdf_submit")}
								</Button>
							</Form>
						</details>
					)}
				</AvisoCard>
			)}

			{/* D — Pre-cert sheet */}
			{panel === "PRECERT" && isAvisoSaved(doc) && (
				<section className="bg-card border rounded-lg p-4">
					<dl
						data-testid="precert-job-info"
						className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]"
					>
						{(
							[
								["address", invoiceHeader.address ?? "—"],
								["aviso", doc.avisoNumber ?? "—"],
								["supervisor", supervisor?.name ?? user.name],
								["crew", invoiceHeader.brigadeName ?? "—"],
							] as const
						).map(([key, value]) => (
							<div key={key} className="contents">
								<dt className="text-muted-foreground">
									{t(`precert.info.${key}`)}
								</dt>
								<dd className="font-medium">{value}</dd>
							</div>
						))}
					</dl>
				</section>
			)}
			{panel === "PRECERT" && isAvisoSaved(doc) && (
				<section className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">{t("precert.heading")}</h2>
					{error?.noteKey && (
						<Pill variant="info" icon="ℹ">
							{t(error.noteKey as ParseKeys)}
						</Pill>
					)}
					{!sheet ? (
						interactive && (
							<Form method="post">
								<input type="hidden" name="intent" value="generate_precert" />
								<Button type="submit">{t("precert.generate")}</Button>
							</Form>
						)
					) : (
						<PreCertPanel
							sheet={sheet}
							doc={doc}
							brigade={brigade}
							error={error ?? null}
							readOnly={!interactive}
							showPrices={showPrices}
						/>
					)}
				</section>
			)}

			{/* E — Release (step 8) */}
			{panel === "RELEASE" && isAvisoSaved(doc) && (
				<section className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">
						{t("release.heading", {
							done: gate.rows.filter((r) => r.ok).length,
							total: gate.rows.length,
						})}
					</h2>
					<ul className="text-sm space-y-1">
						{gate.rows.map((r) => (
							<li
								key={r.key}
								className={r.ok ? "text-status-ok" : "text-status-danger"}
							>
								{r.ok ? "✓" : "✗"} {t(RELEASE_ROW_KEYS[r.key])}
								{r.key === "aviso" && r.detail ? ` · #${r.detail}` : ""}
								{r.key === "photos"
									? ` · ${t("release.photos_added", { n: Number(r.detail ?? 0) })}`
									: ""}
							</li>
						))}
					</ul>
					{error?.errorKey === "docs_review.errors.release_blocked" && (
						<p className="text-sm text-status-danger">
							{t("docs_review.errors.release_blocked")}
						</p>
					)}
					{doc.releasedToFinanceAt ? (
						<Pill variant="info" icon="✓">
							{t("release.released_at", {
								date: new Date(doc.releasedToFinanceAt).toLocaleString(),
							})}
						</Pill>
					) : interactive ? (
						<div className="flex gap-2">
							<Link
								to="?step=PRECERT"
								className={buttonVariants({ variant: "outline" })}
							>
								{t("release.back")}
							</Link>
							<Form method="post" className="flex-1">
								<input type="hidden" name="intent" value="release_to_finance" />
								<Button type="submit" disabled={!gate.ok} className="w-full">
									{t("release.button")}
								</Button>
							</Form>
						</div>
					) : null}
					<p className="text-xs text-muted-foreground">
						{t("docs_review.supervisor")}: {supervisor?.name ?? user.name}
					</p>
				</section>
			)}
		</div>
	)
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

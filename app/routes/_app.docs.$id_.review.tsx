import { readFile } from "node:fs/promises"
import type { ParseKeys } from "i18next"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { AvisoCard, type AvisoHistoryRow } from "~/components/aviso-card"
import { DocStageBadge } from "~/components/doc-stage-badge"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { DownloadIconLink } from "~/components/file-viewer"
import { FixMistakeCard } from "~/components/fix-mistake-card"
import {
	GuideBox,
	GuideCounter,
	useFormGuidance,
} from "~/components/form-guidance"
import {
	type PacketStepBlocker,
	PacketStepCard,
	type PacketStepData,
} from "~/components/packet-step"
import { ReturnedBanner } from "~/components/returned-banner"
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
	GeneratePackage,
	WorkOrderDocumentCard,
} from "~/components/work-order-document"
import {
	AVISO_REPLACE_LIMIT,
	type AvisoDiscrepancy,
	type AvisoHistoryEntry,
} from "~/lib/aviso-discrepancy"
import { isAvisoSaved } from "~/lib/aviso-document"
import {
	compareMaterials,
	type MaterialDifference,
} from "~/lib/aviso-materials"
import {
	AvisoPdfError,
	normaliseAvisoNumber,
	readAvisoMaterials,
	readAvisoNumber,
} from "~/lib/aviso-pdf.server"
import {
	CONTRACTOR_SHARE_PERCENT,
	RETENTION_RATE,
} from "~/lib/contractor-payment.server"
import { BASE_SHARE_PERCENT, shareFigures } from "~/lib/contractor-share"
import { db } from "~/lib/db.server"
import { isPacketEmailEnabled } from "~/lib/features.server"
import { fieldMaterialsOrDefault } from "~/lib/field-materials"
import type { AddressCorrection } from "~/lib/field-update-helpers"
import {
	uploadFileName,
	validateBlueprintFile,
	validateFile,
} from "~/lib/file-upload.server"
import { fixModeFor } from "~/lib/fix-mode"
import { invoiceNumberFor } from "~/lib/invoice-number"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { openJobLabel } from "~/lib/open-job-label"
import { packageFiles } from "~/lib/package-files"
import { packetBlockers } from "~/lib/packet-blockers"
import {
	buildPacketInput,
	buildPrefieldInput,
	loadWorkOrderDocument,
	sendPacket,
} from "~/lib/packet-send.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"
import { generateClaroPrefieldPdf } from "~/lib/pdf/claro-prefield.server"
import { canTransition, isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	activeSheet,
	activeSheetById,
	activeSheets,
	createPreCertSheet,
	isSheetSigned,
	preCertLinesFor,
	renderPreCert,
} from "~/lib/pre-cert.server"
import { evaluateReleaseGate, isPacketPath } from "~/lib/release-gate"
import {
	isReturned,
	isWithFinance,
	latestReturn,
	markResent,
} from "~/lib/returned-packet"
import { returnedInfo } from "~/lib/returned-packet.server"
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
	fixStepFor,
	isAvisoStarted,
	isPreCertSigned,
	panelForStep,
	resolveStepView,
	SUPERVISOR_STAGES,
	supervisorStepHref,
} from "~/lib/supervisor-stage"
import { getIvuRate } from "~/lib/system-settings.server"
import { isLegacyPricedInvoice, uploadHref } from "~/lib/upload-href"
import {
	moveUpload,
	photosThatLoad,
	restoreUpload,
	saveBuffer,
	saveUpload,
} from "~/lib/uploads.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import { type PreCertSheet, Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.review"

type MaterialLine = { serviceCodeId: string; qty: number }

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

type AvisoMaterialsCheck =
	| { kind: "skipped" | "unreadable" }
	| { kind: "compared"; differences: MaterialDifference[] }

/**
 * Step 6's best-effort materials comparison (never blocks on its own): the
 * work order's material lines (the used rows the work order document prints)
 * against the Aviso's "MATERIALES USADOS" table, by Claro code. Skipped when
 * the materials did not come from the warehouse (no baseline); "unreadable"
 * when the table cannot be read with confidence.
 */
async function checkAvisoMaterials(
	doc: {
		materialsFromWarehouse: boolean
		fieldMaterials: unknown
		materialsTaken: unknown
	},
	pdf: Uint8Array,
): Promise<AvisoMaterialsCheck> {
	if (!doc.materialsFromWarehouse) return { kind: "skipped" }
	const rows = fieldMaterialsOrDefault(
		doc.fieldMaterials,
		(doc.materialsTaken as MaterialLine[] | null) ?? [],
	).filter((r) => r.used > 0)
	const [catalog, codes] = await Promise.all([
		getActiveServiceCodes(),
		rows.length > 0
			? db.serviceCode.findMany({
					where: { id: { in: rows.map((r) => r.serviceCodeId) } },
					select: { id: true, claroCode: true, name: true },
				})
			: Promise.resolve([]),
	])
	const aviso = await readAvisoMaterials(
		pdf,
		new Set(catalog.map((c) => c.claroCode)),
	)
	if (aviso === null) return { kind: "unreadable" }
	const byId = new Map(codes.map((c) => [c.id, c]))
	const workOrder = rows.flatMap((r) => {
		const code = byId.get(r.serviceCodeId)
		return code
			? [{ claroCode: code.claroCode, name: code.name, used: r.used }]
			: []
	})
	return { kind: "compared", differences: compareMaterials(workOrder, aviso) }
}

/** Replace Aviso lost a race: the job's one replacement was used meanwhile. */
class ReplaceLimitReached extends Error {}

const differencesOf = (check: AvisoMaterialsCheck) =>
	check.kind === "compared" ? check.differences : []

/** A JSON column value, or SQL NULL for `null`. */
const jsonOrDbNull = (v: unknown) =>
	v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue)

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
		sheets,
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
		activeSheets(params.id),
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
	// The first certificate; a job with several crews has one per crew.
	const sheet = sheets[0] ?? null
	const stage = deriveSupervisorStage(doc, sheets)
	// Released and not sent back: Finance holds it, the steps are locked.
	const withFinance = isWithFinance(doc)
	// Sent back by Finance: the Aviso step reopens, signed Pre-cert or not.
	const sentBack = isReturned(doc)
	const preCertSigned = isPreCertSigned(sheets)
	const { view, interactive } = resolveStepView(
		stage,
		isAvisoStarted(doc),
		new URL(request.url).searchParams.get("step"),
		preCertSigned,
		sentBack,
	)
	// Step 6 after the save: the replaced Avisos (kept, marked "replaced") and
	// whether the job's one replacement is still open.
	const avisoReplacements = isAvisoSaved(doc)
		? await db.auditTrail.count({
				where: { docId: params.id, action: "AVISO_REPLACED" },
			})
		: 0
	// A packet Finance returned is exempt: the return asks for an Aviso fix.
	const replaceUsed = !sentBack && avisoReplacements >= AVISO_REPLACE_LIMIT
	const avisoHistory: AvisoHistoryRow[] = (
		(doc.avisoHistory as AvisoHistoryEntry[] | null) ?? []
	).map((h) => ({
		avisoNumber: h.avisoNumber,
		href: `/files/aviso-docs/${h.path.split(/[\\/]/).pop()}`,
		reason: h.reason,
		replacedAt: h.replacedAt,
	}))
	const aviso = {
		discrepancy: (doc.avisoDiscrepancy as AvisoDiscrepancy | null) ?? null,
		history: avisoHistory,
		replaceUsed,
		canReplace:
			interactive &&
			view === "AVISO" &&
			isAvisoSaved(doc) &&
			!withFinance &&
			(!preCertSigned || sentBack) &&
			!replaceUsed,
	}
	const loadingPhotos = await photosThatLoad(params.id, photos)
	const gate = evaluateReleaseGate({
		doc,
		sheet: sheets,
		photos: loadingPhotos,
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
		brigadeName:
			sheets.length > 1
				? sheets
						.map((x) =>
							x.brigadeCode
								? `${x.brigadeName} · ${x.brigadeCode}`
								: x.brigadeName,
						)
						.join(" + ")
				: brigade
					? brigade.code
						? `${brigade.name} · ${brigade.code}`
						: brigade.name
					: null,
		workDate: (doc.startedAt ?? doc.fieldSubmittedAt)?.toISOString() ?? null,
	}
	if (lineTotal != null && showPrices) {
		const ivuRate = await getIvuRate()
		const contractorFigures = shareFigures(lineTotal, BASE_SHARE_PERCENT)
		const contractor = contractorFigures.net
		// Per-line IVU from the stored invoice lines; a total with no lines
		// behind it counts as one line.
		const storedLines = Array.isArray(doc.jafInvoiceLines)
			? (doc.jafInvoiceLines as InvoiceLine[])
			: []
		const totals = computeInvoiceTotals(
			storedLines.length > 0 ? storedLines : [{ qty: 1, unitPrice: lineTotal }],
			ivuRate,
		)
		invoiceSummary = {
			number: invoiceNumberFor(doc),
			lineTotal,
			ivuRate,
			ivu: totals.ivu,
			total: round2(lineTotal + totals.ivu),
			sharePercent: CONTRACTOR_SHARE_PERCENT,
			contractor,
			retentionPercent: RETENTION_RATE,
			contractorNet: contractorFigures.adjNet,
		}
	}
	// Step 5 · Packet → Claro. "Sent" is the first SENT/MANUAL send
	// (`jafInvoiceGeneratedAt`); a stored PDF alone is not, since an
	// UNCONFIGURED attempt also stores one for the manual path.
	const claro = doc.claroSupervisor
	const sent = doc.jafInvoiceGeneratedAt != null
	const blockers: PacketStepBlocker[] = sent
		? []
		: [
				...(claro ? [] : (["claro_supervisor"] as const)),
				...packetBlockers(doc, {
					requiresBlueprint: claro?.requiresBlueprint ?? false,
				}),
			]
	const codeById = new Map(materialCodes.map((c) => [c.id, c]))
	const emailEnabled = isPacketEmailEnabled()
	// The package: the generated PDFs and the original photos and blueprints,
	// as step 5 lists them. Server paths stay on the server.
	const files = packageFiles(doc, loadingPhotos).map(
		({ path: _path, ...f }) => f,
	)
	const packet: PacketStepData = {
		sent,
		sentAt: doc.jafInvoiceGeneratedAt,
		claroSupervisor: claro ? { name: claro.name, email: claro.email } : null,
		claroSupervisorId: doc.claroSupervisorId,
		claroOptions,
		prefieldNeeded: doc.prefieldNeeded,
		blockers,
		// Only a real packet: a legacy priced invoice in jaf-invoices/ is not one.
		packetHref: isPacketPath(doc.jafInvoicePdfPath)
			? uploadHref(doc.jafInvoicePdfPath as string)
			: null,
		files,
		zipHref: files.length > 0 ? `/docs/${doc.id}/package` : null,
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

	// Step 4 · the work order document, and Generate package: open once the
	// supervisor has signed and a Claro supervisor is chosen, until the first
	// send to Claro locks it. A job sent under the old flow has no work order
	// PDF yet, so it stays open for it until the release.
	const workOrder =
		panelForStep(view) === "APPROVE"
			? await loadWorkOrderDocument(params.id, user.name)
			: null
	const canGeneratePdf =
		!!doc.supervisorApprovedAt &&
		!withFinance &&
		!isTerminalStatus(doc.status) &&
		(isSentUnderOldFlow(doc) ||
			(isSig(doc.completionSignature) && !doc.jafInvoiceGeneratedAt && !!claro))

	// Supervisors never see money, on the certificates either.
	const forViewer = <T extends (typeof sheets)[number] | null>(x: T): T =>
		x && !showPrices
			? ({
					...(({ total: _total, ...rest }) => rest)(x),
					lines: linesWithoutPrices(x.lines),
				} as unknown as T)
			: x

	const { claroSupervisor: claroRow, ...docRest } = doc
	// The name travels with the doc so every step can print it beside the JAF supervisor's.
	const docData = { ...docRest, claroSupervisorName: claroRow?.name ?? null }
	return {
		doc: showPrices ? docData : withoutPrices(docData),
		user,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		supervisor,
		sheet: forViewer(sheet),
		sheets: sheets.map(forViewer),
		brigade,
		stage,
		openLabel: openJobLabel(doc, sheets),
		view,
		interactive,
		gate,
		invoiceSummary,
		// Finance sent the packet back: the latest reason, until it is released again.
		// A return on a job that is not released (sent back before S4 kept the
		// release): the latest unanswered reason. A released returned packet
		// shows the Returned banner instead.
		financeReturn: doc.releasedToFinanceAt
			? null
			: (() => {
					const latest = latestReturn(doc)
					return latest && !latest.resentAt ? latest : null
				})(),
		invoicePreview: showPrices ? preview : linesWithoutPrices(preview),
		invoiceHeader,
		showPrices,
		correctorNames,
		packet,
		aviso,
		workOrder,
		workOrderIssuedOn: (doc.completionSignedAt ?? new Date()).toISOString(),
		canGeneratePdf,
		withFinance,
		returned: await returnedInfo(doc),
		fixMode: fixModeFor(doc, user.role),
		// Who signed off (Step 4). Before this redesign it was the crew lead.
		signedOffBy: doc.completedById
			? (correctorNames[doc.completedById] ?? null)
			: null,
	}
}

/** The certificate a form targets: its `sheetId`, else the first. */
function sheetFromForm(form: FormData, docId: string) {
	const id = (form.get("sheetId") as string | null)?.trim()
	return id ? activeSheetById(docId, id) : activeSheet(docId)
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
		// Signed: stay on step 4, where Generate package is now open.
		throw redirect(`/docs/${params.id}/review?step=APPROVE`)
	}

	// Step 4 · Generate package: render the work order document and store it
	// as the job's packet PDF and, when the job's intake answer is "Prefield
	// needed", render the Claro Prefield (JAF's part filled in, Claro's boxes
	// blank) next to it. Nothing about the Prefield blocks it. Only after
	// sign-off (a missing warehouse or crew signature prints "Pending" and
	// never blocks), and only until the first send to Claro: regenerating
	// before then replaces the stored files and clears a stale package. A job
	// sent under the old flow (a priced invoice, or nothing, stored) has no
	// work order PDF for the release gate, so it may generate one until the
	// release; what it already sent is not touched (no Prefield, no stale).
	if (intent === "generate_package") {
		const oldFlow = isSentUnderOldFlow(doc)
		if (
			(doc.jafInvoiceGeneratedAt && !oldFlow) ||
			isWithFinance(doc) ||
			isTerminalStatus(doc.status)
		)
			return { errorKey: "packet.errors.locked" }
		if (
			!doc.supervisorApprovedAt ||
			(!oldFlow && !isSig(doc.completionSignature))
		)
			return { errorKey: "packet.errors.not_signed_off" }
		if (!oldFlow && !doc.claroSupervisor)
			return { errorKey: "packet.errors.no_claro_supervisor" }
		const withPrefield = !oldFlow && doc.prefieldNeeded
		let pdfPath: string
		let prefieldPath: string | null = null
		try {
			const pdf = await generateClaroPacketPdf(
				await buildPacketInput(params.id),
			)
			pdfPath = await saveBuffer(
				"packets",
				`${params.id}-work-order-${Date.now()}.pdf`,
				pdf,
			)
			if (withPrefield)
				prefieldPath = await saveBuffer(
					"packets",
					`${params.id}-prefield-${Date.now()}.pdf`,
					await generateClaroPrefieldPdf(await buildPrefieldInput(params.id)),
				)
		} catch {
			return { errorKey: "packet.errors.render_failed" }
		}
		const data: Prisma.JafInvoiceUncheckedUpdateManyInput = oldFlow
			? { jafInvoicePdfPath: pdfPath }
			: {
					jafInvoicePdfPath: pdfPath,
					prefieldPdfPath: prefieldPath,
					packetStale: false,
				}
		const stored = await db.$transaction(async (tx) => {
			// A send that landed while rendering wins: nothing changes. An
			// old-flow job only checks nobody stored another file meanwhile.
			const updated = await tx.jafInvoice.updateMany({
				where: oldFlow
					? { id: params.id, jafInvoicePdfPath: doc.jafInvoicePdfPath }
					: { id: params.id, jafInvoiceGeneratedAt: null },
				data,
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
						prefieldGenerated: withPrefield,
						...(!oldFlow && doc.prefieldPdfPath !== prefieldPath
							? {
									prefieldPdfPath: {
										before: doc.prefieldPdfPath,
										after: prefieldPath,
									},
								}
							: {}),
						...(!oldFlow && doc.packetStale
							? { packetStale: { before: true, after: false } }
							: {}),
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
	// supervisor sent the downloaded package themselves. `sendPacket` owns the
	// gates (sign-off, Claro supervisor, Prefield PDF, stale package,
	// blueprint), the send log and the first-send lock; every outcome lands
	// back on the step, whose history and banner say what happened.
	if (intent === "send_packet" || intent === "mark_packet_sent") {
		const result = await sendPacket({
			docId: params.id,
			actor: { id: user.id, role: user.role, name: user.name },
			mode: intent === "send_packet" ? "email" : "manual",
		})
		if (!result.ok) return { errorKey: result.errorKey }
		throw redirect(`/docs/${params.id}/review`)
	}

	// Step 5 · the Claro supervisor and (when that supervisor needs one) a
	// blueprint can be changed here until the first send; after it they are
	// what Claro received. The Prefield boxes are Claro's: there is no input
	// for them. A new Claro supervisor changes what both generated PDFs print,
	// so they are cleared and step 4 generates the package again; a blueprint
	// travels as its own file and leaves them as they are.
	if (intent === "save_packet_details") {
		if (doc.jafInvoiceGeneratedAt)
			return { errorKey: "packet.errors.prefield_locked" }
		if (isWithFinance(doc) || isTerminalStatus(doc.status))
			return { errorKey: "packet.errors.locked" }
		const data: Prisma.JafInvoiceUncheckedUpdateInput = {}
		const changes: Record<string, { before: unknown; after: unknown }> = {}
		const claroId =
			((form.get("claroSupervisorId") as string | null) ?? "").trim() || null
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
			for (const k of ["jafInvoicePdfPath", "prefieldPdfPath"] as const)
				if (doc[k]) {
					data[k] = null
					changes[k] = { before: doc[k], after: null }
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
	// The generated package no longer matches what will be signed: it is
	// cleared, and step 4 generates it again.
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
					...(doc.prefieldPdfPath ? { prefieldPdfPath: null } : {}),
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
						...(doc.prefieldPdfPath
							? {
									prefieldPdfPath: { before: doc.prefieldPdfPath, after: null },
								}
							: {}),
					},
				},
			}),
		])
		// Back to Field, where the mistake is fixed; sign-off comes after.
		throw redirect(`/docs/${params.id}/field`)
	}

	// "Fix a mistake" once the packet has gone to Claro (or later): the job is
	// not reopened here. Every administrator is told what is wrong, and the
	// request is logged on the job.
	if (intent === "request_fix") {
		const note = (form.get("note") as string | null)?.trim() || ""
		if (!note) return { errorKey: "docs_review.errors.back_note_required" }
		if (user.role !== "SUPERVISOR" || fixModeFor(doc, user.role) !== "request")
			throw redirect(`/docs/${params.id}/review`)
		const admins = await db.user.findMany({
			where: { role: "ADMIN", active: true },
			select: { id: true },
		})
		await db.$transaction([
			...(admins.length > 0
				? [
						db.notification.createMany({
							data: admins.map((a) => ({
								userId: a.id,
								docId: params.id,
								message: `${user.name} asks to fix ${doc.controlNumber}: ${note}`,
							})),
						}),
					]
				: []),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "FIX_REQUESTED",
					diffJson: { note, status: doc.status },
				},
			}),
		])
		return { requestedFix: true as const }
	}

	if (intent === "save_aviso") {
		// Step 6: the hard check is that the number on the file equals the typed
		// one. Then, best effort, the materials table is compared with the work
		// order: differing rows need a note to continue (never a block on its
		// own); an unreadable table only says so. Amounts are never compared.
		if (!doc.jafInvoiceGeneratedAt)
			return { errorKey: "docs_review.errors.invoice_required" }
		if (isWithFinance(doc)) throw redirect(`/docs/${params.id}/review`)

		const typed = (form.get("avisoNumber") as string | null)?.trim() || null
		if (!typed) return { errorKey: "docs_review.errors.aviso_number_required" }

		const avisoPdf = form.get("avisoPdf")
		const newFile =
			avisoPdf instanceof File && avisoPdf.size > 0 ? avisoPdf : null
		// A saved Aviso only changes through Replace Aviso (limited, with a reason).
		if (newFile && isAvisoSaved(doc))
			return { errorKey: "docs_review.errors.aviso_use_replace" }
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

		// Only a new file is compared. A re-save of the file on record keeps
		// the stored discrepancy as is (only a replacement clears it) and only
		// fills a missing note.
		const prior = doc.avisoDiscrepancy as AvisoDiscrepancy | null
		const materials: AvisoMaterialsCheck | { kind: "kept" } = newFile
			? await checkAvisoMaterials(doc, pdfBytes)
			: { kind: "kept" }
		const differences =
			materials.kind === "kept"
				? (prior?.differences ?? [])
				: differencesOf(materials)
		let discrepancy: AvisoDiscrepancy | null = null
		if (differences.length > 0) {
			const note = (form.get("discrepancyNote") as string | null)?.trim() || ""
			const now = new Date().toISOString()
			if (materials.kind === "kept" && prior?.note) discrepancy = prior
			else if (!note)
				return {
					errorKey: "docs_review.errors.aviso_materials_differ",
					differences,
				}
			else
				discrepancy = {
					// Still the same open difference: its age keeps counting.
					detectedAt: prior?.detectedAt ?? now,
					differences,
					note,
					noteAt: now,
					noteById: user.id,
				}
		}

		// A new file or number regenerates the sheet; a signed one is kept as is.
		const sheets = await activeSheets(params.id)
		const changed = !!newFile || avisoNumber !== doc.avisoNumber
		const keepSigned = sheets.length > 0 && changed && isSheetSigned(sheets)
		const generate = sheets.length === 0 || (changed && !keepSigned)

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
					avisoDiscrepancy: jsonOrDbNull(discrepancy),
					...(transition
						? { status: "CLARO_UPLOADED", claroUploadedAt: new Date() }
						: {}),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_SAVED",
					diffJson: {
						avisoNumber,
						fileUploaded: !!newFile,
						materials: materials.kind,
						differences,
						note: discrepancy?.note ?? null,
					} as unknown as Prisma.InputJsonValue,
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
		if (materials.kind === "unreadable")
			return { info: "docs_review.aviso_materials_unreadable" }
		throw redirect(`/docs/${params.id}/review`)
	}

	// Replace Aviso (from step 7 back to step 6): for a one-time mistake (wrong
	// document, typo). One per job, counted from the audit trail, with a reason;
	// only until any Pre-cert signature exists, and never after the release.
	// The old file is moved aside (never overwritten) and kept in the history.
	// The number check and the materials comparison run again: a clean result
	// clears the discrepancy, a new difference raises a fresh one.
	if (intent === "replace_aviso") {
		if (isWithFinance(doc)) throw redirect(`/docs/${params.id}/review`)
		if (!isAvisoSaved(doc) || !doc.avisoDocPath)
			return { errorKey: "docs_review.errors.aviso_pdf_required" }
		// A signed Pre-cert locks the Aviso, unless Finance sent the packet back:
		// then the replacement supersedes the signed sheet (below) and the
		// supervisor re-signs a fresh one before the release gate passes again.
		if (!isReturned(doc) && isPreCertSigned(await activeSheets(params.id)))
			return { errorKey: "docs_review.errors.replace_locked" }
		const used = await db.auditTrail.count({
			where: { docId: params.id, action: "AVISO_REPLACED" },
		})
		// A returned packet is exempt from the one-replacement limit: Finance
		// sent it back for an Aviso correction. Every other job keeps it.
		const limited = !isReturned(doc)
		if (limited && used >= AVISO_REPLACE_LIMIT)
			return { errorKey: "docs_review.errors.replace_limit" }
		const reason = (form.get("replaceReason") as string | null)?.trim() || ""
		if (!reason)
			return { errorKey: "docs_review.errors.replace_reason_required" }
		const typed = (form.get("avisoNumber") as string | null)?.trim() || null
		if (!typed) return { errorKey: "docs_review.errors.aviso_number_required" }
		const avisoPdf = form.get("avisoPdf")
		if (!(avisoPdf instanceof File) || avisoPdf.size === 0)
			return { errorKey: "docs_review.errors.aviso_pdf_required" }
		const validation = validateFile(avisoPdf, "pdf")
		if (!validation.valid) return { errorMessage: validation.error }
		const pdfBytes = new Uint8Array(await avisoPdf.arrayBuffer())
		const checked = await checkAvisoNumber(typed, pdfBytes)
		if ("errorKey" in checked)
			return {
				errorKey: checked.errorKey,
				typedNumber: checked.typedNumber,
				pdfAvisoNumber: checked.pdfAvisoNumber,
			}
		const { avisoNumber } = checked
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		if ((await preCertLinesFor(installed)).lines.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }

		const materials = await checkAvisoMaterials(doc, pdfBytes)
		const differences = differencesOf(materials)
		const now = new Date().toISOString()
		// Same rule as the first save: a differing Aviso needs a note. It is a
		// fresh discrepancy: the note on the replaced Aviso is not carried over.
		let discrepancy: AvisoDiscrepancy | null = null
		if (differences.length > 0) {
			const note = (form.get("discrepancyNote") as string | null)?.trim() || ""
			if (!note)
				return {
					errorKey: "docs_review.errors.aviso_materials_differ",
					differences,
				}
			discrepancy = {
				detectedAt: now,
				differences,
				note,
				noteAt: now,
				noteById: user.id,
			}
		}

		// Everything validated: move the old file aside (never over an existing
		// one: a concurrent replacement already took the slot), then store the
		// new one and record both. Any failure after the move puts the old file
		// back, so the job still points at a file that exists.
		const original = doc.avisoDocPath
		let replacedPath: string
		try {
			replacedPath = await moveUpload(
				original,
				"aviso-docs",
				`${params.id}-aviso-replaced-${used + 1}.pdf`,
			)
		} catch (e) {
			if ((e as { code?: string }).code === "EEXIST")
				return { errorKey: "docs_review.errors.replace_limit" }
			return { errorKey: "docs_review.errors.replace_failed" }
		}
		const history: AvisoHistoryEntry[] = [
			...((doc.avisoHistory as AvisoHistoryEntry[] | null) ?? []),
			{
				avisoNumber: doc.avisoNumber,
				path: replacedPath,
				reason,
				replacedAt: now,
				replacedById: user.id,
			},
		]
		try {
			const avisoDocPath = await saveUpload(
				"aviso-docs",
				`${params.id}-aviso.pdf`,
				avisoPdf,
			)
			await db.$transaction(async (tx) => {
				// Re-checked here: another request may have replaced it meanwhile.
				const replaced = await tx.auditTrail.count({
					where: { docId: params.id, action: "AVISO_REPLACED" },
				})
				if (limited && replaced >= AVISO_REPLACE_LIMIT)
					throw new ReplaceLimitReached()
				await tx.jafInvoice.update({
					where: { id: params.id },
					data: {
						avisoNumber,
						avisoDocPath,
						avisoDiscrepancy: jsonOrDbNull(discrepancy),
						avisoHistory: history as unknown as Prisma.InputJsonValue,
					},
				})
				await tx.auditTrail.create({
					data: {
						docId: params.id,
						userId: user.id,
						action: "AVISO_REPLACED",
						diffJson: {
							before: { avisoNumber: doc.avisoNumber, path: replacedPath },
							after: { avisoNumber },
							reason,
							materials: materials.kind,
							differences,
							note: discrepancy?.note ?? null,
						} as unknown as Prisma.InputJsonValue,
					},
				})
			})
		} catch (e) {
			try {
				await restoreUpload(replacedPath, original)
			} catch {
				// Best effort: the job's record still names the original path.
			}
			return {
				errorKey:
					e instanceof ReplaceLimitReached
						? "docs_review.errors.replace_limit"
						: "docs_review.errors.replace_failed",
			}
		}
		// The sheet is regenerated: a new, unsigned version supersedes the
		// active one (signed only on a returned packet, kept in the history).
		// The Aviso is already replaced; if the render fails the old sheet stays
		// active, and the release gate refuses it (it names the old Aviso) until
		// a new sheet is generated and signed.
		try {
			await createPreCertSheet({
				docId: params.id,
				actor: { id: user.id, role: user.role },
			})
		} catch {
			return { errorKey: "docs_review.errors.replace_precert_failed" }
		}
		if (materials.kind === "unreadable")
			return { info: "docs_review.aviso_materials_unreadable" }
		throw redirect(`/docs/${params.id}/review?step=AVISO`)
	}

	// Manual fallback: the sheet is generated on Aviso save, but a failed render
	// (or an explicit regenerate on the sheet) can still create the next version.
	if (intent === "generate_precert") {
		if (!isAvisoSaved(doc))
			return { errorKey: "docs_review.errors.aviso_pdf_required" }
		if (isWithFinance(doc)) throw redirect(`/docs/${params.id}/review`)
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
		const sheet = await sheetFromForm(form, params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		if (sheet.sigSupervisorAt)
			return { errorKey: "docs_review.errors.precert_locked" }
		const reason = (form.get("reason") as string | null)?.trim() || ""
		if (!reason)
			return { errorKey: "docs_review.errors.precert_edit_reason_required" }
		const serviceCodeId = form.get("serviceCodeId") as string
		// Decimals kept (2.5 ft stays 2.5); a line may be certified at 0.
		const rawQty = ((form.get("certifiedQty") as string | null) ?? "").trim()
		const certifiedQty = Number(rawQty)
		if (!rawQty || !Number.isFinite(certifiedQty) || certifiedQty < 0)
			return { errorKey: "docs_review.errors.precert_qty_invalid" }
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
		const sheet = await sheetFromForm(form, params.id)
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
		const sheet = await sheetFromForm(form, params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		// The signing crew: the certificate's own on a multi-crew job.
		const signingBrigadeId = sheet.brigadeId ?? doc.brigadeId
		const brigade = signingBrigadeId
			? await db.brigade.findUnique({ where: { id: signingBrigadeId } })
			: null
		// A one-crew job's payee. With several crews each is paid from its own
		// lines at the sweep, so the signature fixes no single payee.
		const oneCrew = !sheet.brigadeId
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
			...(oneCrew
				? [
						db.jafInvoice.update({
							where: { id: params.id },
							data: { contractorAccountCode: code },
						}),
					]
				: []),
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
		const sheet = await sheetFromForm(form, params.id)
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
		if (isWithFinance(doc)) throw redirect(`/docs/${params.id}/review`)
		// Finance sent it back: this release is the supervisor's answer to her
		// latest note (S4), stamped on the note and logged with it. Any
		// unanswered latest note counts, also one Finance wrote before this job
		// was ever released (older data): left unstamped, the release itself
		// would turn it Returned again with that stale note.
		const latest = latestReturn(doc)
		const answering = latest && !latest.resentAt ? latest : null
		const [sheets, photos] = await Promise.all([
			activeSheets(params.id),
			db.photo.findMany({
				where: { docId: params.id },
				select: { tag: true, localPath: true },
			}),
		])
		const gate = evaluateReleaseGate({
			doc,
			sheet: sheets,
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
			sheets[0]?.sigSubcontractorName ??
			brigade?.leadName ??
			brigade?.name ??
			""
		// No amount in the message: supervisors can read their own notifications
		// back, and they never see money.
		const message = answering
			? `${doc.controlNumber} · Aviso ${doc.avisoNumber} · ${contractor} — fixed and sent back to Finance`
			: `${doc.controlNumber} · Aviso ${doc.avisoNumber} · ${contractor} — ready for payment request`
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		const releasedAt = new Date()
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					releasedToFinanceAt: releasedAt,
					releasedToFinanceById: user.id,
					...(answering && {
						financeSendBackNotes: markResent(
							doc.financeSendBackNotes,
							releasedAt,
						) as Prisma.InputJsonValue,
					}),
				},
			}),
			db.auditTrail.create({
				data: answering
					? {
							docId: params.id,
							userId: user.id,
							action: "FINANCE_RESEND",
							// The note answered, and the gate it passed again.
							diffJson: { note: answering.note, rows: gate.rows },
						}
					: {
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
	sheetId,
	guided = false,
}: {
	/** The certificate being signed, when the job has one per crew. */
	sheetId?: string
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
	/** The only signature on the page: light it and count it, as on Sign off. */
	guided?: boolean
}) {
	const { t } = useTranslation()
	const padRef = useRef<SignaturePadHandle>(null)
	const [cleared, setCleared] = useState(0)
	const [padEmpty, setPadEmpty] = useState(true)
	const [hasScan, setHasScan] = useState(false)
	const boxId = `g-sig-${intent}${sheetId ? `-${sheetId}` : ""}`
	// A required signature (or its scan) is the box; Continue never goes quiet.
	const guide = useFormGuidance(
		optional
			? []
			: [{ id: boxId, label: t(labelKey), empty: padEmpty && !hasScan }],
		{ glow: guided },
	)
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
			onChange={(e) => {
				const target = e.target as unknown as HTMLInputElement
				if (target.name === "scan") setHasScan(!!target.files?.length)
			}}
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
			{sheetId && <input type="hidden" name="sheetId" value={sheetId} />}
			<input type="hidden" name={fieldName} />
			{header}
			{children}
			<GuideBox id={boxId} guide={guide} className="space-y-1">
				<SignaturePad
					key={cleared}
					ref={padRef}
					width={280}
					height={90}
					className="w-full border rounded bg-card"
					onChange={setPadEmpty}
				/>
				<p className="text-xs text-muted-foreground">
					{t("precert.sign_here")}
				</p>
			</GuideBox>
			{guided && <GuideCounter guide={guide} />}
			<div className="flex items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setCleared((c) => c + 1)}
				>
					{t("precert.clear_signature")}
				</Button>
				<Button
					type="submit"
					size="sm"
					className="ml-auto"
					onClick={(e) => guide.holdContinue(e)}
				>
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
					guided
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
	crewHeading,
	sheetId,
}: {
	/** "Crew 2 · NAME · code", when the job has a certificate per crew. */
	crewHeading?: string
	sheetId?: string
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
		<div
			className="space-y-3"
			data-testid={sheetId ? `precert-${sheetId}` : undefined}
		>
			{crewHeading && <h3 className="text-sm font-semibold">{crewHeading}</h3>}
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="font-medium">
					{t("precert.version", { n: sheet?.version ?? 1 })}
				</span>
				{sheet?.pdfPath && (
					<DownloadIconLink
						href={`/files/precert/${doc.id}-v${sheet.version}.pdf`}
						name={`Pre-cert ${doc.controlNumber} v${sheet.version}.pdf`}
						label={t("precert.download")}
					/>
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
						{sheetId && <input type="hidden" name="sheetId" value={sheetId} />}
						<input type="hidden" name="serviceCodeId" value={l.serviceCodeId} />
						<span className="font-mono">{l.claroCode}</span>
						<Input
							name="certifiedQty"
							type="number"
							inputMode="decimal"
							step="any"
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
				<p className="text-xs text-muted-foreground">
					{t("docs_review.precert.note")}
				</p>
				{!readOnly && (
					<p className="text-xs text-muted-foreground">
						{t("precert.signatures_hint")}
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-3">
				<SignatureBlock
					intent="sign_precert_supervisor"
					sheetId={sheetId}
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
					sheetId={sheetId}
					labelKey="precert.sig_subcontractor"
					readOnly={readOnly}
					optional
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
					sheetId={sheetId}
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
									<DownloadIconLink
										href={`/files/precert/${doc.id}-claro-scan.jpg`}
										name={`Pre-cert Claro scan ${doc.controlNumber}.jpg`}
										label={t("precert.download")}
									/>
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
			{!readOnly && !isWithFinance(doc) && (
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
		supervisor,
		sheet,
		sheets,
		brigade,
		stage,
		openLabel,
		view,
		interactive,
		gate,
		invoiceHeader,
		showPrices,
		financeReturn,
		packet,
		aviso,
		workOrder,
		workOrderIssuedOn,
		canGeneratePdf,
		withFinance,
		returned,
		fixMode,
		signedOffBy,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as
		| {
				errorKey?: string
				errorMessage?: string
				noteKey?: string
				info?: string
				typedNumber?: string
				pdfAvisoNumber?: string
				differences?: MaterialDifference[]
				rows?: { key: string; ok: boolean }[]
				requestedFix?: true
		  }
		| undefined
	const panel = panelForStep(view)
	// Signed, not sent, but no Claro supervisor to generate the package for:
	// step 4 says to choose one on step 5.
	const pdfBlocked =
		!!doc.supervisorApprovedAt &&
		!packet.sent &&
		packet.blockers.includes("claro_supervisor")
	// Step 4 stays actionable after signing, for Generate package, until the send.
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
			<SupervisorStepRail
				stage={stage}
				view={view}
				docId={doc.id}
				warehouseSkipped={!doc.materialsFromWarehouse}
			/>
			{financeReturn && (
				<Pill variant="warn" icon="↩">
					<b>{t("docs_review.finance_return_title")}</b>{" "}
					{t("docs_review.finance_return_body", {
						note: financeReturn.note,
						date: new Date(financeReturn.createdAt).toLocaleDateString(),
					})}
				</Pill>
			)}
			{returned && doc.status !== "CANCELLED" && (
				<p className="text-sm">
					{t("docs_review.returned_open_hint")}{" "}
					<Link to={`/docs/${doc.id}/field`} className="underline">
						{t("docs_review.returned_open_field")}
					</Link>
					{" · "}
					<Link to={`/docs/${doc.id}/edit`} className="underline">
						{t("docs_review.returned_open_edit")}
					</Link>
				</p>
			)}
			{returned && doc.status !== "CANCELLED" && (
				<ReturnedBanner
					returned={returned}
					// Already on the step that fixes it: no link to itself.
					fixHref={
						view === fixStepFor(stage, true)
							? null
							: supervisorStepHref(doc.id, fixStepFor(stage, true))
					}
				/>
			)}
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
			{fixMode && (
				<FixMistakeCard
					mode={fixMode}
					errorKey={error?.errorKey}
					requested={!!error?.requestedFix}
				/>
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
					{sheets.length > 1 && (
						<section
							className="space-y-2 rounded-lg border p-3"
							data-testid="crew-certificates"
						>
							<h2 className="text-sm font-medium">
								{t("docs_review.crew_certificates_title", {
									count: sheets.length,
								})}
							</h2>
							<ul className="divide-y text-sm">
								{sheets.map((sh) => (
									<li key={sh.id} className="py-2">
										<p className="font-medium">
											{sh.brigadeName}
											{sh.brigadeCode ? ` (${sh.brigadeCode})` : ""}
										</p>
										<p className="text-xs text-muted-foreground">
											{(sh.lines as PreCertLine[])
												.map((l) => `${l.claroCode} × ${l.certifiedQty}`)
												.join(" · ")}
										</p>
									</li>
								))}
							</ul>
						</section>
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
								<li>{t("work_order_doc.blocker.claro_supervisor")}</li>
							</ul>
							<Link to="?step=INVOICE" className="underline">
								{t("work_order_doc.blockers_fix")}
							</Link>
						</Pill>
					)}
					{signOffOpen && (
						<GeneratePackage
							enabled={canGeneratePdf}
							pdfHref={packet.packetHref}
							continueHref={
								packet.sent || doc.packetStale
									? null
									: `/docs/${doc.id}/review?step=INVOICE`
							}
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
					locked={withFinance}
					readOnly={!interactive}
					result={error ?? null}
					discrepancy={aviso.discrepancy}
					history={aviso.history}
					canReplace={aviso.canReplace}
					replaceUsed={aviso.replaceUsed}
					continueHref={
						isAvisoSaved(doc) && stage !== "AVISO" ? "?step=PRECERT" : null
					}
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
								["claro_supervisor", doc.claroSupervisorName ?? "—"],
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
					{!sheet
						? interactive && (
								<Form method="post">
									<input type="hidden" name="intent" value="generate_precert" />
									<Button type="submit">{t("precert.generate")}</Button>
								</Form>
							)
						: sheets.map((sh, i) => {
								// One certificate per crew: each has its own signatures.
								const perCrew = sheets.length > 1
								const crewBrigade =
									perCrew && sh.brigadeId && sh.brigadeId !== doc.brigadeId
										? ({
												leadName: null,
												name: sh.brigadeName,
												code: sh.brigadeCode,
											} as unknown as typeof brigade)
										: brigade
								return (
									<PreCertPanel
										key={sh.id}
										sheet={sh}
										doc={doc}
										brigade={crewBrigade}
										error={error ?? null}
										readOnly={!interactive}
										showPrices={showPrices}
										sheetId={perCrew ? sh.id : undefined}
										crewHeading={
											perCrew
												? `${t("precert.crew_certificate", { n: i + 1, total: sheets.length })} · ${sh.brigadeName ?? ""}${sh.brigadeCode ? ` · ${sh.brigadeCode}` : ""}`
												: undefined
										}
									/>
								)
							})}
					{/* Back to step 6: Replace Aviso until a Pre-cert signature,
					    view-only after it (`resolveStepView`). */}
					{interactive && !withFinance && (
						<Link
							to="?step=AVISO"
							className={buttonVariants({
								variant: "ghost",
								className: "w-full",
							})}
						>
							{t("precert.back_to_aviso")}
						</Link>
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
								{r.key === "precert_signed" && r.detail ? ` · ${r.detail}` : ""}
							</li>
						))}
					</ul>
					{error?.errorKey === "docs_review.errors.release_blocked" && (
						<p className="text-sm text-status-danger">
							{t("docs_review.errors.release_blocked")}
						</p>
					)}
					{withFinance && doc.releasedToFinanceAt ? (
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
									{returned
										? t("returned_packet.resend_button")
										: t("release.button")}
								</Button>
							</Form>
						</div>
					) : null}
					<p className="text-xs text-muted-foreground">
						{t("docs_review.supervisor")}: {supervisor?.name ?? user.name}
						{doc.claroSupervisorName
							? ` · ${t("docs_review.claro_supervisor")}: ${doc.claroSupervisorName}`
							: ""}
					</p>
				</section>
			)}
		</div>
	)
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

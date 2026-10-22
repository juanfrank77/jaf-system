import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { redirect } from "react-router"
import type {
	PacketSendOutcome,
	Prisma,
	Role,
} from "../../generated/prisma/client"
import { assignedBrigadeIds } from "./crew-assignment"
import { db } from "./db.server"
import { isPacketEmailEnabled } from "./features.server"
import { packageFiles, uniqueFileNames } from "./package-files"
import { packetBlockers } from "./packet-blockers"
import { sendPacketEmail } from "./packet-mail.server"
import {
	type ClaroPacketInput,
	generateClaroPacketPdf,
} from "./pdf/claro-packet.server"
import type { ClaroPrefieldInput } from "./pdf/claro-prefield.server"
import { isTerminalStatus } from "./permissions"
import { sanitizedError } from "./redact"
import { isPacketPath } from "./release-gate"
import { getActiveServiceCodes } from "./service-codes.server"
import {
	buildInvoiceLines,
	type InvoiceLine,
	type ServiceLine,
	sumLines,
} from "./service-lines"
import { assertDocInSupervisorScope } from "./supervisor-scope"
import { getIvuRate } from "./system-settings.server"
import { photoFile, saveBuffer } from "./uploads.server"
import {
	buildWorkOrderDocument,
	type WorkOrderDocument,
	workOrderAddress,
} from "./work-order-document"

type SendPacketErrorKey =
	// "Prefield needed" and "Generate package" has not made the Prefield PDF.
	| "packet.errors.prefield_pdf_missing"
	// An intake answer changed after the package was generated.
	| "packet.errors.package_stale"
	| "packet.errors.blueprint_missing"
	| "packet.errors.no_claro_supervisor"
	| "packet.errors.not_signed_off"
	| "packet.errors.locked"
	// Email sending is off (PACKET_EMAIL_ENABLED) or no work order PDF is stored.
	| "packet.errors.email_disabled"
	| "packet.errors.pdf_missing"
	// Building or storing the PDF failed; logged as a FAILED attempt.
	| "packet.errors.render_failed"
	// Nothing installed to put in the work summary.
	| "docs_review.errors.installed_lines_required"

type SendPacketResult =
	| { ok: true; outcome: PacketSendOutcome }
	| { ok: false; errorKey: SendPacketErrorKey }

const SIGNED_OFF_STATUSES = ["SUPERVISOR_APPROVED", "CLARO_UPLOADED"]

/**
 * Step 5 · Packet → Claro: record a manual send of the package generated at
 * step 4 (no re-render), or, with PACKET_EMAIL_ENABLED, build the work order
 * PDF and email it to the job's Claro supervisor with the rest of the package
 * (the Prefield PDF when the job needs it, and the original photo and
 * blueprint files, each as its own attachment); log the attempt either way.
 *
 * The first SENT or MANUAL attempt locks the invoice lines and sets
 * `jafInvoiceGeneratedAt`, conditionally (`where jafInvoiceGeneratedAt is
 * null`) so a double click or a resend can never move it. Until then
 * `packetBlockers` gates the send (the Prefield PDF when needed, a stale
 * package, the Claro supervisor's blueprint rule); after it nothing does, and
 * every resend goes to that supervisor's current email.
 */
export async function sendPacket(args: {
	docId: string
	actor: { id: string; role: Role; name: string }
	mode: "email" | "manual"
}): Promise<SendPacketResult> {
	const { docId, actor, mode } = args
	if (mode === "email" && !isPacketEmailEnabled())
		return { ok: false, errorKey: "packet.errors.email_disabled" }
	if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN")
		throw redirect("/dashboard")
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: docId },
		include: {
			brigade: { select: { area: true } },
			claroSupervisor: true,
		},
	})
	if (actor.role === "SUPERVISOR")
		await assertDocInSupervisorScope(db, actor.id, doc)

	if (doc.releasedToFinanceAt || isTerminalStatus(doc.status))
		return { ok: false, errorKey: "packet.errors.locked" }
	if (!doc.supervisorApprovedAt || !SIGNED_OFF_STATUSES.includes(doc.status))
		return { ok: false, errorKey: "packet.errors.not_signed_off" }
	const claro = doc.claroSupervisor
	if (!claro)
		return { ok: false, errorKey: "packet.errors.no_claro_supervisor" }

	const firstSent = doc.jafInvoiceGeneratedAt !== null
	if (!firstSent) {
		const blockers = packetBlockers(doc, claro)
		if (blockers.includes("prefield_pdf"))
			return { ok: false, errorKey: "packet.errors.prefield_pdf_missing" }
		if (blockers.includes("stale"))
			return { ok: false, errorKey: "packet.errors.package_stale" }
		if (blockers.includes("blueprint"))
			return { ok: false, errorKey: "packet.errors.blueprint_missing" }
	}

	// Reviewed means locked: once sent, the lines Claro saw stay the lines the
	// Aviso is matched against, whatever is edited afterwards.
	let lines: InvoiceLine[]
	if (firstSent) {
		lines = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	} else {
		const catalog = await getActiveServiceCodes()
		const codeMap = Object.fromEntries(catalog.map((c) => [c.id, c]))
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		lines = buildInvoiceLines(installed, codeMap)
		if (lines.length === 0)
			return {
				ok: false,
				errorKey: "docs_review.errors.installed_lines_required",
			}
	}
	const lineTotal = sumLines(lines)
	// Recorded with the first send only (see the PACKET_SENT diff below).
	const ivuRate = firstSent ? null : await getIvuRate()

	// Manual mode sends nothing: it records that the supervisor emailed the
	// package generated at step 4 (never an old priced invoice), so that work
	// order PDF is reused as is.
	if (mode === "manual" && !isPacketPath(doc.jafInvoicePdfPath))
		return { ok: false, errorKey: "packet.errors.pdf_missing" }

	const recipientEmail = claro.email
	// The intake answer, as stored on the job (never the Claro supervisor's tag).
	const prefieldNeeded = doc.prefieldNeeded
	// An email send renders one file per attempt, so two quick clicks never
	// write the same file; it is the PDF that was attached.
	let attachments: { filename: string; content: Buffer }[] = []
	let pdfPath: string
	try {
		if (mode === "manual") {
			pdfPath = doc.jafInvoicePdfPath as string
		} else {
			const pdf = await generateClaroPacketPdf(await buildPacketInput(docId))
			pdfPath = await saveBuffer(
				"packets",
				`${docId}-packet-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`,
				pdf,
			)
			attachments = await packageAttachments(doc, pdf)
		}
	} catch (cause) {
		const error = sanitizedError(cause)
		await db.$transaction([
			db.packetSend.create({
				data: {
					docId,
					sentById: actor.id,
					recipientEmail,
					claroSupervisorId: claro.id,
					outcome: "FAILED",
					error,
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: actor.id,
					action: "PACKET_SENT",
					diffJson: {
						mode,
						outcome: "FAILED",
						recipientEmail,
						claroSupervisorId: claro.id,
						prefieldNeeded,
						firstSend: false,
						renderFailed: true,
						error,
					},
				},
			}),
		])
		return { ok: false, errorKey: "packet.errors.render_failed" }
	}

	let outcome: PacketSendOutcome
	let error: string | undefined
	if (mode === "manual") {
		outcome = "MANUAL"
	} else {
		const result = await sendPacketEmail({
			to: recipientEmail,
			subject: `JAF — Work order / Orden de trabajo ${doc.controlNumber}`,
			text: [
				`JAF work order ${doc.controlNumber}, attached.`,
				`Adjunta la orden de trabajo de JAF ${doc.controlNumber}.`,
			].join("\n\n"),
			attachments,
		})
		outcome = result.outcome
		error = result.error
	}
	const delivered = outcome === "SENT" || outcome === "MANUAL"

	await db.$transaction(async (tx) => {
		await tx.packetSend.create({
			data: {
				docId,
				sentById: actor.id,
				recipientEmail,
				claroSupervisorId: claro.id,
				outcome,
				error: error ?? null,
			},
		})
		// The first delivered attempt wins; a concurrent one updates nothing.
		const first = delivered
			? await tx.jafInvoice.updateMany({
					where: { id: docId, jafInvoiceGeneratedAt: null },
					data: {
						jafInvoiceGeneratedAt: new Date(),
						jafInvoiceLines: lines as unknown as Prisma.InputJsonValue,
						jafInvoiceLineTotal: lineTotal,
						...(mode === "email" ? { jafInvoicePdfPath: pdfPath } : {}),
					},
				})
			: { count: 0 }
		// The stored packet is the last one delivered. Before the first send it
		// is also the latest attempt, so the supervisor can download it after an
		// UNCONFIGURED attempt and "Mark as sent manually"; after the first
		// send, an undelivered attempt never replaces what Claro has.
		if (mode === "email" && first.count === 0 && delivered)
			await tx.jafInvoice.update({
				where: { id: docId },
				data: { jafInvoicePdfPath: pdfPath },
			})
		if (mode === "email" && !delivered)
			await tx.jafInvoice.updateMany({
				where: { id: docId, jafInvoiceGeneratedAt: null },
				data: { jafInvoicePdfPath: pdfPath },
			})
		await tx.auditTrail.create({
			data: {
				docId,
				userId: actor.id,
				action: "PACKET_SENT",
				diffJson: {
					mode,
					outcome,
					recipientEmail,
					claroSupervisorId: claro.id,
					path: pdfPath,
					prefieldNeeded,
					firstSend: first.count === 1,
					// The IVU rate at the first send, so the priced invoice Finance
					// re-renders later keeps it whatever the setting becomes.
					...(first.count === 1 ? { lineTotal, lines, ivuRate } : {}),
					...(error ? { error } : {}),
				} as Prisma.InputJsonValue,
			},
		})
	})

	return { ok: true, outcome }
}

type FirstSendDiff = {
	firstSend?: boolean
	ivuRate?: number
}

/** The audit diff of the first delivered send, if any. */
async function firstSendDiff(
	docId: string,
): Promise<FirstSendDiff | undefined> {
	const sends = await db.auditTrail.findMany({
		where: { docId, action: "PACKET_SENT" },
		orderBy: { timestamp: "asc" },
		select: { diffJson: true },
	})
	return sends
		.map((s) => (s.diffJson ?? {}) as FirstSendDiff)
		.find((d) => d.firstSend)
}

/**
 * The IVU rate recorded at the first send; today's setting for a job sent
 * before the rate was recorded.
 */
export async function ivuRateAtFirstSend(docId: string): Promise<number> {
	const first = await firstSendDiff(docId)
	return typeof first?.ivuRate === "number" ? first.ivuRate : getIvuRate()
}

/**
 * The email's attachments, in package order: the work order PDF just
 * rendered, the Prefield PDF generated at step 4 (only when the job needs it;
 * the send gate makes sure it exists), then the original photo and blueprint
 * files as stored, never converted. A missing original is skipped; a missing
 * Prefield PDF fails the attempt.
 */
async function packageAttachments(
	doc: {
		id: string
		controlNumber: string
		prefieldPdfPath: string | null
		prefieldNeeded: boolean
		blueprintPaths: string[]
	},
	workOrderPdf: Buffer,
): Promise<{ filename: string; content: Buffer }[]> {
	const photos = await db.photo.findMany({
		where: { docId: doc.id },
		select: { localPath: true, takenAt: true },
	})
	const rest = packageFiles(
		{ ...doc, jafInvoicePdfPath: null },
		photos.map((p) => ({
			localPath: photoFile(doc.id, p.localPath),
			takenAt: p.takenAt,
		})),
	)
	const files: { filename: string; content: Buffer }[] = [
		{
			filename: `JAF-work-order-${doc.controlNumber}.pdf`,
			content: workOrderPdf,
		},
	]
	for (const f of rest) {
		if (f.key === "prefield_pdf") {
			files.push({
				filename: `JAF-prefield-${doc.controlNumber}.pdf`,
				content: await readFile(f.path),
			})
			continue
		}
		const content = await readFile(f.path).catch(() => null)
		if (content) files.push({ filename: f.name, content })
	}
	const names = uniqueFileNames(files.map((f) => f.filename))
	return files.map((f, i) => ({ ...f, filename: names[i] }))
}

/**
 * The job's work order document (spec step 4, B5) from stored data. The JAF
 * supervisor is whoever signed off, else `viewerName` (the logged-in
 * supervisor on the page), else the job's supervisor.
 */
export async function loadWorkOrderDocument(
	docId: string,
	viewerName?: string,
): Promise<WorkOrderDocument> {
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: docId },
		include: {
			claroSupervisor: { select: { name: true } },
			supervisor: { select: { name: true } },
			completedBy: { select: { name: true } },
			releasedBy: { select: { name: true } },
			signedBy: { select: { name: true } },
		},
	})
	const brigadeIds = assignedBrigadeIds(doc)
	const materialIds = fieldMaterialIds(doc.fieldMaterials, doc.materialsTaken)
	const [brigades, codes] = await Promise.all([
		brigadeIds.length > 0
			? db.brigade.findMany({
					where: { id: { in: brigadeIds } },
					select: { id: true, name: true, code: true },
				})
			: Promise.resolve([]),
		materialIds.length > 0
			? db.serviceCode.findMany({
					where: { id: { in: materialIds } },
					select: { id: true, name: true, unit: true },
				})
			: Promise.resolve([]),
	])
	const byId = new Map(brigades.map((b) => [b.id, b]))
	return buildWorkOrderDocument(doc, {
		claroSupervisor: doc.claroSupervisor,
		jafSupervisor: doc.completedBy?.name ?? viewerName ?? doc.supervisor.name,
		crews: brigadeIds.flatMap((id) => {
			const b = byId.get(id)
			return b ? [{ name: b.name, code: b.code }] : []
		}),
		materialCodes: codes,
		signers: {
			supervisor: doc.completedBy?.name ?? null,
			warehouse: doc.releasedBy?.name ?? null,
			crew: doc.signedBy?.name ?? null,
		},
	})
}

/**
 * What the work order PDF renders: the document, dated at sign-off, with the
 * pickup signatures page on the warehouse path only.
 */
export async function buildPacketInput(
	docId: string,
): Promise<ClaroPacketInput> {
	const [document, dates] = await Promise.all([
		loadWorkOrderDocument(docId),
		db.jafInvoice.findUniqueOrThrow({
			where: { id: docId },
			select: { completionSignedAt: true, supervisorApprovedAt: true },
		}),
	])
	return {
		document,
		issuedOn:
			dates.completionSignedAt ?? dates.supervisorApprovedAt ?? new Date(),
		showPickupSignatures: document.materialsFromWarehouse,
	}
}

/**
 * What the Claro Prefield PDF prints in JAF's part: the work order, the job,
 * the JAF supervisor (whoever signed off, else the job's supervisor) with
 * their area as the Dept # (the first one; null when none is assigned), and
 * the Claro supervisor. Claro's boxes are not inputs: they print blank.
 */
export async function buildPrefieldInput(
	docId: string,
): Promise<ClaroPrefieldInput> {
	const person = { select: { name: true, supervisorAreas: true } }
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: docId },
		include: {
			claroSupervisor: { select: { name: true } },
			supervisor: person,
			completedBy: person,
		},
	})
	const jaf = doc.completedBy ?? doc.supervisor
	return {
		workOrderNumber: doc.controlNumber,
		address: workOrderAddress(doc),
		title: doc.jobDescription?.trim() || null,
		jafSupervisor: jaf.name,
		deptNumber: jaf.supervisorAreas[0]?.trim() || null,
		claroSupervisor: doc.claroSupervisor?.name ?? null,
		issuedOn: doc.completionSignedAt ?? doc.supervisorApprovedAt ?? new Date(),
	}
}

/** The catalog ids the materials box names. */
function fieldMaterialIds(stored: unknown, taken: unknown): string[] {
	const ids = new Set<string>()
	for (const list of [stored, taken])
		if (Array.isArray(list))
			for (const r of list)
				if (r && typeof r.serviceCodeId === "string") ids.add(r.serviceCodeId)
	return [...ids]
}

import { randomUUID } from "node:crypto"
import path from "node:path"
import { redirect } from "react-router"
import type {
	PacketSendOutcome,
	Prisma,
	Role,
} from "../../generated/prisma/client"
import { assignedBrigadeIds } from "./crew-assignment"
import { db } from "./db.server"
import { sendPacketEmail } from "./packet-mail.server"
import {
	blueprintAttachments,
	type ClaroPacketInput,
	generateClaroPacketPdf,
} from "./pdf/claro-packet.server"
import { isTerminalStatus } from "./permissions"
import { packetBlockers } from "./prefield"
import { sanitizedError } from "./redact"
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
} from "./work-order-document"

type SendPacketErrorKey =
	| "packet.errors.prefield_missing"
	| "packet.errors.blueprint_missing"
	| "packet.errors.no_claro_supervisor"
	| "packet.errors.not_signed_off"
	| "packet.errors.locked"
	// Building or storing the PDF failed; logged as a FAILED attempt.
	| "packet.errors.render_failed"
	// Nothing installed to put in the work summary.
	| "docs_review.errors.installed_lines_required"

type SendPacketResult =
	| { ok: true; outcome: PacketSendOutcome }
	| { ok: false; errorKey: SendPacketErrorKey }

const SIGNED_OFF_STATUSES = ["SUPERVISOR_APPROVED", "CLARO_UPLOADED"]

/**
 * Step 5 · Packet → Claro: build the packet PDF from stored data, email it to
 * the job's Claro supervisor (or record a manual send), and log the attempt.
 *
 * The first SENT or MANUAL attempt locks the invoice lines and sets
 * `jafInvoiceGeneratedAt`, conditionally (`where jafInvoiceGeneratedAt is
 * null`) so a double click or a resend can never move it. Until then the
 * Claro supervisor's Prefield / blueprint rules gate the send; after it they
 * no longer apply, but every resend goes to that supervisor's current email.
 */
export async function sendPacket(args: {
	docId: string
	actor: { id: string; role: Role; name: string }
	mode: "email" | "manual"
}): Promise<SendPacketResult> {
	const { docId, actor, mode } = args
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
		if (blockers.includes("prefield"))
			return { ok: false, errorKey: "packet.errors.prefield_missing" }
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

	const packet = await buildPacketInput(docId)
	const showPrefield = packet.document.prefield !== "not_required"
	const recipientEmail = claro.email
	// One file per attempt, so two quick clicks never write the same file. For
	// an email send it is the PDF that was attached; for MANUAL it is a fresh
	// render from the same stored data, not necessarily the exact file the
	// supervisor downloaded and sent by hand.
	let pdf: Buffer
	let pdfPath: string
	try {
		pdf = await generateClaroPacketPdf(packet)
		pdfPath = await saveBuffer(
			"packets",
			`${docId}-packet-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`,
			pdf,
		)
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
						showPrefield,
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
			attachments: [
				{ filename: `JAF-work-order-${doc.controlNumber}.pdf`, content: pdf },
				...(await blueprintAttachments(doc.blueprintPaths)),
			],
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
						jafInvoicePdfPath: pdfPath,
					},
				})
			: { count: 0 }
		// The stored packet is the last one delivered. Before the first send it
		// is also the latest attempt, so the supervisor can download it after an
		// UNCONFIGURED attempt and "Mark as sent manually"; after the first
		// send, an undelivered attempt never replaces what Claro has.
		if (first.count === 0 && delivered)
			await tx.jafInvoice.update({
				where: { id: docId },
				data: { jafInvoicePdfPath: pdfPath },
			})
		if (!delivered)
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
					showPrefield,
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
	showPrefield?: boolean
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

/** After the first send flag edits no longer apply: keep that send's layout. */
async function prefieldShownAtFirstSend(
	docId: string,
	fallback: boolean,
): Promise<boolean> {
	const first = await firstSendDiff(docId)
	return typeof first?.showPrefield === "boolean"
		? first.showPrefield
		: fallback
}

type Refs = "files" | "urls"

/**
 * The job's work order document (spec step 4, B5) from stored data. `refs`
 * says how photos and blueprints are referenced: file paths for the PDF,
 * page URLs for the step 4 screen. The JAF supervisor is whoever signed off,
 * else `viewerName` (the logged-in supervisor on the page), else the job's
 * supervisor. After the first send the Prefield block keeps that send's
 * layout, whatever the Claro supervisor's flag says now.
 */
export async function loadWorkOrderDocument(
	docId: string,
	refs: Refs,
	viewerName?: string,
): Promise<WorkOrderDocument> {
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: docId },
		include: {
			claroSupervisor: {
				select: { name: true, requiresPrefield: true, requiresBlueprint: true },
			},
			photos: { select: { localPath: true, tag: true, takenAt: true } },
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
	const claro = doc.claroSupervisor
	const requiresPrefield =
		claro && doc.jafInvoiceGeneratedAt
			? await prefieldShownAtFirstSend(docId, claro.requiresPrefield)
			: (claro?.requiresPrefield ?? false)
	return buildWorkOrderDocument(doc, {
		claroSupervisor: claro ? { ...claro, requiresPrefield } : null,
		jafSupervisor: doc.completedBy?.name ?? viewerName ?? doc.supervisor.name,
		crews: brigadeIds.flatMap((id) => {
			const b = byId.get(id)
			return b ? [{ name: b.name, code: b.code }] : []
		}),
		materialCodes: codes,
		photos: photoGroups(docId, doc.photos, refs),
		blueprints: doc.blueprintPaths.map((p) =>
			refs === "files"
				? p
				: `/files/blueprints/${encodeURIComponent(docId)}/${encodeURIComponent(path.basename(p))}`,
		),
		signers: {
			supervisor: doc.completedBy?.name ?? null,
			warehouse: doc.releasedBy?.name ?? null,
			crew: doc.signedBy?.name ?? null,
		},
	})
}

/** What the work order PDF renders: the document with file paths, dated at sign-off. */
export async function buildPacketInput(
	docId: string,
): Promise<ClaroPacketInput> {
	const [document, dates] = await Promise.all([
		loadWorkOrderDocument(docId, "files"),
		db.jafInvoice.findUniqueOrThrow({
			where: { id: docId },
			select: { completionSignedAt: true, supervisorApprovedAt: true },
		}),
	])
	return {
		document,
		issuedOn:
			dates.completionSignedAt ?? dates.supervisorApprovedAt ?? new Date(),
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

/**
 * Photos grouped Before / During / After in the order taken, as the files
 * the viewer serves (`<UPLOAD_DIR>/photos/<docId>/<basename>`) or their URLs.
 * Untagged photos count as During. Missing files are skipped by the PDF.
 */
function photoGroups(
	docId: string,
	photos: {
		localPath: string
		tag: "BEFORE" | "DURING" | "AFTER" | null
		takenAt: Date
	}[],
	refs: Refs,
): WorkOrderDocument["photos"] {
	const groups: WorkOrderDocument["photos"] = {
		before: [],
		during: [],
		after: [],
	}
	const key = { BEFORE: "before", DURING: "during", AFTER: "after" } as const
	const sorted = [...photos].sort(
		(a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
	)
	for (const p of sorted)
		groups[key[p.tag ?? "DURING"]].push(
			refs === "files"
				? photoFile(docId, p.localPath)
				: `/files/photos/${docId}/${path.basename(p.localPath)}`,
		)
	return groups
}

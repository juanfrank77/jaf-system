import { randomUUID } from "node:crypto"
import { redirect } from "react-router"
import type {
	PacketSendOutcome,
	Prisma,
	Role,
} from "../../generated/prisma/client"
import { db } from "./db.server"
import { fieldMaterialsOrDefault } from "./field-materials"
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
import { photoFile, saveBuffer } from "./uploads.server"

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

type MaterialLine = { serviceCodeId: string; qty: number }

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
			photos: { select: { localPath: true, tag: true, takenAt: true } },
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

	const showPrefield = firstSent
		? await prefieldShownAtFirstSend(docId, claro.requiresPrefield)
		: claro.requiresPrefield

	const signer = doc.completedById
		? await db.user.findUnique({
				where: { id: doc.completedById },
				select: { name: true },
			})
		: null
	const materials = await materialRows(
		doc.fieldMaterials,
		(doc.materialsTaken as MaterialLine[] | null) ?? [],
	)

	const packet: ClaroPacketInput = {
		controlNumber: doc.controlNumber,
		claroSupervisorName: claro.name,
		showPrefield,
		prefield: {
			avisoNumber: doc.avisoNumber,
			ordenNumber: doc.ordenNumber,
			pedido: doc.pedido,
			smr: doc.smr,
			titulo: doc.titulo,
			description: doc.jobDescription,
		},
		address: {
			direccion1: doc.direccion1,
			direccion2: doc.direccion2,
			sector: doc.sector,
			ciudad: doc.ciudad,
			latitud: doc.latitud,
			longitud: doc.longitud,
			tipo: doc.tipo,
			tipoPlanta: doc.tipoPlanta,
			grupoPlan: doc.grupoPlan,
		},
		job: {
			address: doc.jobAddressActual ?? doc.jobAddressEstimated,
			jobType: doc.jobType,
			description: doc.jobDescription,
			workDate: doc.startedAt ?? doc.fieldSubmittedAt,
			avisoNumber: doc.avisoNumber,
		},
		workSummary: lines.map((l) => ({
			claroCode: l.claroCode,
			name: l.name,
			qty: l.qty,
			unit: l.unit ?? null,
		})),
		materials,
		photos: photoGroups(docId, doc.photos),
		blueprints: doc.blueprintPaths,
		supervisorName: signer?.name ?? actor.name,
		signedOffAt: doc.completionSignedAt ?? doc.supervisorApprovedAt,
	}
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
			subject: `IMS — Work packet / Paquete de trabajo ${doc.controlNumber}`,
			text: [
				`Work packet for job ${doc.controlNumber} from IMS, attached.`,
				`Adjunto el paquete de trabajo de IMS para el trabajo ${doc.controlNumber}.`,
			].join("\n\n"),
			attachments: [
				{ filename: `IMS-packet-${doc.controlNumber}.pdf`, content: pdf },
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
					...(first.count === 1 ? { lineTotal, lines } : {}),
					...(error ? { error } : {}),
				} as Prisma.InputJsonValue,
			},
		})
	})

	return { ok: true, outcome }
}

/** After the first send flag edits no longer apply: keep that send's layout. */
async function prefieldShownAtFirstSend(
	docId: string,
	fallback: boolean,
): Promise<boolean> {
	const sends = await db.auditTrail.findMany({
		where: { docId, action: "PACKET_SENT" },
		orderBy: { timestamp: "asc" },
		select: { diffJson: true },
	})
	const first = sends
		.map((s) => s.diffJson as { firstSend?: boolean; showPrefield?: boolean })
		.find((d) => d.firstSend)
	return typeof first?.showPrefield === "boolean"
		? first.showPrefield
		: fallback
}

/** The Field materials table, with code names and units but no prices. */
async function materialRows(
	stored: unknown,
	taken: MaterialLine[],
): Promise<ClaroPacketInput["materials"]> {
	const rows = fieldMaterialsOrDefault(stored, taken)
	if (rows.length === 0) return []
	const codes = await db.serviceCode.findMany({
		where: { id: { in: rows.map((r) => r.serviceCodeId) } },
		select: { id: true, claroCode: true, name: true, unit: true },
	})
	const byId = new Map(codes.map((c) => [c.id, c]))
	return rows.map((r) => {
		const code = byId.get(r.serviceCodeId)
		return {
			claroCode: code?.claroCode ?? "",
			name: code?.name ?? r.serviceCodeId,
			unit: code?.unit ?? null,
			used: r.used,
			returned: r.returned,
			source: r.source,
		}
	})
}

/**
 * Photo files grouped Before / During / After, resolved the way the photo
 * viewer serves them (`<UPLOAD_DIR>/photos/<docId>/<basename>`). Untagged
 * photos count as During. Missing files are skipped by the PDF renderer.
 */
function photoGroups(
	docId: string,
	photos: {
		localPath: string
		tag: "BEFORE" | "DURING" | "AFTER" | null
		takenAt: Date
	}[],
): ClaroPacketInput["photos"] {
	const groups: ClaroPacketInput["photos"] = {
		BEFORE: [],
		DURING: [],
		AFTER: [],
	}
	const sorted = [...photos].sort(
		(a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
	)
	for (const p of sorted)
		groups[p.tag ?? "DURING"].push(photoFile(docId, p.localPath))
	return groups
}

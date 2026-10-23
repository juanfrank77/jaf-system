import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { getDocumentProxy } from "unpdf"
import { db } from "~/lib/db.server"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { getPoReader, type PoReader } from "~/lib/po-reader.server"
import {
	type PoCheck,
	type PoLine,
	type PoRead,
	runPoChecks,
	statusFromChecks,
} from "~/lib/po-reading"
import { saveBuffer } from "~/lib/uploads.server"
import type { Prisma } from "../../generated/prisma/client"

type PoErrorCode =
	| "not_confirmable"
	| "incomplete"
	| "duplicate"
	| "aviso_not_found"
	| "already_confirmed"
	| "not_pdf"
	| "unknown_po"

export class PoError extends Error {
	constructor(readonly code: PoErrorCode) {
		super(code)
		this.name = "PoError"
	}
}

const PENDING_STUCK_MINUTES = 10
const POOL_SIZE = 4

const num = (d: Prisma.Decimal | null | undefined) =>
	d === null || d === undefined ? null : Number(d)

/** Save the uploaded PDFs and queue them to be read. Returns the new row ids. */
export async function ingestPoFiles(
	files: { name: string; bytes: Uint8Array }[],
	uploadedById: string,
): Promise<string[]> {
	const ids: string[] = []
	for (const f of files) {
		// %PDF-: refuse anything else before it reaches the reader.
		if (Buffer.from(f.bytes.subarray(0, 5)).toString() !== "%PDF-")
			throw new PoError("not_pdf")
		const hash = createHash("sha256").update(f.bytes).digest("hex")
		const stored = await saveBuffer(
			"claro-po",
			`${randomUUID()}.pdf`,
			Buffer.from(f.bytes),
		)
		const row = await db.claroPo.create({
			data: {
				filePath: stored,
				fileName: f.name.slice(0, 200),
				fileHash: hash,
				uploadedById,
			},
			select: { id: true },
		})
		ids.push(row.id)
	}
	return ids
}

async function pagesIn(bytes: Uint8Array): Promise<number> {
	const pdf = await getDocumentProxy(bytes.slice())
	return pdf.numPages
}

type RowLike = {
	id: string
	poNumber: string | null
	poDate: Date | null
	termsDays: number | null
	statedPages: number | null
	filePages: number | null
	docId: string | null
	fileHash: string
	receivedAt: Date
	avisoCandidates: string[]
	lines: Prisma.JsonValue | null
	subtotal: Prisma.Decimal | null
	ivu4: Prisma.Decimal | null
	ivu115: Prisma.Decimal | null
	total: Prisma.Decimal | null
}

function readOf(row: RowLike): PoRead {
	return {
		poNumber: row.poNumber,
		poDate: row.poDate ? row.poDate.toISOString().slice(0, 10) : null,
		statedPages: row.statedPages,
		termsDays: row.termsDays,
		avisoCandidates: row.avisoCandidates,
		lines: Array.isArray(row.lines) ? (row.lines as unknown as PoLine[]) : [],
		subtotal: num(row.subtotal),
		ivu4: num(row.ivu4),
		ivu115: num(row.ivu115),
		total: num(row.total),
	}
}

/**
 * Work out an Aviso for the PO (the one already linked, else the first
 * candidate number that is an Aviso) and run the checks. Writes the verdict.
 * Safe to call again after any field changes.
 */
async function evaluatePo(id: string): Promise<void> {
	const row = await db.claroPo.findUnique({ where: { id } })
	if (!row) throw new PoError("unknown_po")
	if (row.status === "CONFIRMED") return

	let docId = row.docId
	if (!docId && row.avisoCandidates.length > 0) {
		const found = await db.jafInvoice.findMany({
			where: {
				avisoNumber: { in: row.avisoCandidates },
				status: { not: "CANCELLED" },
			},
			select: { id: true, avisoNumber: true },
		})
		docId =
			row.avisoCandidates
				.map((n) => found.find((f) => f.avisoNumber === n)?.id)
				.find(Boolean) ?? null
	}

	let billedPreIvu: number | null = null
	let alreadyPod = 0
	if (docId) {
		const [doc, others] = await Promise.all([
			db.jafInvoice.findUnique({
				where: { id: docId },
				select: { jafInvoiceLines: true },
			}),
			db.claroPo.findMany({
				where: { docId, status: "CONFIRMED", id: { not: id } },
				select: { subtotal: true },
			}),
		])
		const lines = Array.isArray(doc?.jafInvoiceLines)
			? (doc.jafInvoiceLines as { qty: number; unitPrice: number }[])
			: []
		billedPreIvu = computeInvoiceTotals(lines).subtotal
		alreadyPod = others.reduce((s, o) => s + (num(o.subtotal) ?? 0), 0)
	}

	// The first copy wins: a PO number (or a file) already confirmed, or
	// uploaded earlier, makes this one the duplicate.
	const duplicate =
		(await db.claroPo.count({
			where: {
				id: { not: id },
				OR: [
					...(row.poNumber
						? [
								{
									poNumber: row.poNumber,
									OR: [
										{ status: "CONFIRMED" as const },
										{ receivedAt: { lt: row.receivedAt } },
										{ receivedAt: row.receivedAt, id: { lt: id } },
									],
								},
							]
						: []),
					{
						fileHash: row.fileHash,
						OR: [
							{ status: "CONFIRMED" as const },
							{ receivedAt: { lt: row.receivedAt } },
							{ receivedAt: row.receivedAt, id: { lt: id } },
						],
					},
				],
			},
		})) > 0

	const checks = runPoChecks(readOf(row), {
		filePages: row.filePages ?? 0,
		duplicate,
		billedPreIvu,
		alreadyPod,
	})
	await db.claroPo.update({
		where: { id },
		data: {
			docId,
			checks: checks as unknown as Prisma.InputJsonValue,
			status: statusFromChecks(checks, docId !== null),
		},
	})
}

/** Read one queued PO and store what it says. A failure leaves it Needs a look, never lost. */
async function readPo(id: string, reader: PoReader) {
	const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
	const bytes = new Uint8Array(await fs.readFile(row.filePath))
	const filePages = await pagesIn(bytes).catch(() => 0)
	const unreadable = async (why: string) => {
		const checks: PoCheck[] = [
			{ code: "unreadable", severity: "needs_look", detail: why },
		]
		await db.claroPo.update({
			where: { id },
			data: {
				filePages,
				readError: why,
				checks: checks as unknown as Prisma.InputJsonValue,
				status: "NEEDS_LOOK",
			},
		})
	}
	let read: PoRead
	try {
		read = await reader(bytes)
	} catch (e) {
		return unreadable(e instanceof Error ? e.message : "read_failed")
	}
	await db.claroPo.update({
		where: { id },
		data: {
			filePages,
			readError: null,
			poNumber: read.poNumber,
			poDate: read.poDate ? new Date(`${read.poDate}T12:00:00Z`) : null,
			statedPages: read.statedPages,
			termsDays: read.termsDays,
			avisoCandidates: read.avisoCandidates,
			lines: read.lines as unknown as Prisma.InputJsonValue,
			subtotal: read.subtotal,
			ivu4: read.ivu4,
			ivu115: read.ivu115,
			total: read.total,
		},
	})
	await evaluatePo(id)
}

/** Take the oldest queued PO for this worker; two workers never get the same one. */
async function claimNext(): Promise<string | null> {
	const rows = await db.$queryRaw<{ id: string }[]>`
		UPDATE "ClaroPo" SET "status" = 'READING', "readStartedAt" = now()
		WHERE "id" = (
			SELECT "id" FROM "ClaroPo" WHERE "status" = 'PENDING'
			ORDER BY "receivedAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		RETURNING "id"`
	return rows[0]?.id ?? null
}

/** A read that died with the process is put back in the queue. */
async function requeueStuckReads(now = new Date()) {
	await db.claroPo.updateMany({
		where: {
			status: "READING",
			readStartedAt: {
				lt: new Date(now.getTime() - PENDING_STUCK_MINUTES * 60_000),
			},
		},
		data: { status: "PENDING" },
	})
}

/** Read everything queued, a few at a time. Resolves when the queue is empty. */
export async function processPending(
	reader: PoReader = getPoReader(),
	size = POOL_SIZE,
): Promise<void> {
	const worker = async () => {
		for (;;) {
			const id = await claimNext()
			if (!id) return
			try {
				await readPo(id, reader)
			} catch {
				await db.claroPo
					.update({
						where: { id },
						data: { status: "NEEDS_LOOK", readError: "read_failed" },
					})
					.catch(() => {})
			}
		}
	}
	await Promise.all(Array.from({ length: size }, worker))
}

let draining: Promise<void> | null = null
/** Start reading in the background; one drain per process at a time. */
export function kickProcessing(): void {
	if (draining) return
	draining = requeueStuckReads()
		.then(() => processPending())
		.catch(() => {})
		.finally(() => {
			draining = null
		})
}

/** Put a PO back in the queue to be read again. */
export async function rereadPo(id: string) {
	const r = await db.claroPo.updateMany({
		where: {
			id,
			status: { in: ["NEEDS_LOOK", "BLOCKED", "UNMATCHED", "READY"] },
		},
		data: { status: "PENDING", readError: null },
	})
	if (r.count === 0) throw new PoError("not_confirmable")
	kickProcessing()
}

type PoFixFields = {
	poNumber?: string
	poDate?: string
	termsDays?: number
	subtotal?: number
	ivu4?: number
	ivu115?: number
	total?: number
	avisoNumber?: string
}

/** Fix a field by hand. The change is remembered as ENTERED, with who and when (Rule 4). */
export async function fixPo(id: string, byId: string, f: PoFixFields) {
	const row = await db.claroPo.findUnique({ where: { id } })
	if (!row) throw new PoError("unknown_po")
	if (row.status === "CONFIRMED") throw new PoError("already_confirmed")
	const data: Prisma.ClaroPoUpdateInput = {}
	const touched: string[] = []
	if (f.poNumber !== undefined) {
		data.poNumber = f.poNumber.replace(/\D/g, "") || null
		touched.push("poNumber")
	}
	if (f.poDate !== undefined) {
		data.poDate = f.poDate ? new Date(`${f.poDate}T12:00:00Z`) : null
		touched.push("poDate")
	}
	for (const k of [
		"termsDays",
		"subtotal",
		"ivu4",
		"ivu115",
		"total",
	] as const) {
		if (f[k] !== undefined) {
			data[k] = f[k]
			touched.push(k)
		}
	}
	if (f.avisoNumber !== undefined) {
		const n = f.avisoNumber.replace(/\D/g, "")
		const doc = await db.jafInvoice.findFirst({
			where: { avisoNumber: n, status: { not: "CANCELLED" } },
			select: { id: true },
		})
		if (!doc) throw new PoError("aviso_not_found")
		data.doc = { connect: { id: doc.id } }
		touched.push("aviso")
	}
	const entered = {
		...((row.entered as Record<string, unknown> | null) ?? {}),
		...Object.fromEntries(
			touched.map((k) => [k, { byId, at: new Date().toISOString() }]),
		),
	}
	await db.claroPo.update({
		where: { id },
		data: { ...data, entered: entered as Prisma.InputJsonValue },
	})
	await evaluatePo(id)
}

/** Confirm one PO under its Aviso: saves it there and stamps received / confirmed. */
export async function confirmPo(id: string, userId: string) {
	await db.$transaction(async (tx) => {
		const row = await tx.claroPo.findUnique({ where: { id } })
		if (!row) throw new PoError("unknown_po")
		if (row.status === "CONFIRMED") throw new PoError("already_confirmed")
		if (row.status !== "READY" && row.status !== "NEEDS_LOOK")
			throw new PoError("not_confirmable")
		if (!row.docId || !row.poNumber || !row.poDate)
			throw new PoError("incomplete")
		// Two copies read side by side can both look new: the first to confirm wins.
		const twin = await tx.claroPo.count({
			where: { poNumber: row.poNumber, status: "CONFIRMED", id: { not: id } },
		})
		if (twin > 0) {
			await tx.claroPo.update({
				where: { id },
				data: {
					status: "BLOCKED",
					checks: [
						{ code: "duplicate", severity: "blocked", detail: row.poNumber },
					] as unknown as Prisma.InputJsonValue,
				},
			})
			throw new PoError("duplicate")
		}
		const claimed = await tx.claroPo.updateMany({
			where: { id, status: { in: ["READY", "NEEDS_LOOK"] } },
			data: {
				status: "CONFIRMED",
				confirmedAt: new Date(),
				confirmedById: userId,
			},
		})
		if (claimed.count === 0) throw new PoError("already_confirmed")
		// The older Receivables screens look for a PoLink to know a PO arrived.
		await tx.poLink.create({
			data: {
				docId: row.docId,
				claroPONumber: row.poNumber,
				poDate: row.poDate,
				amount: row.total,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: row.docId,
				userId,
				action: "PO_CONFIRMED",
				diffJson: {
					source: "STAMPED",
					poNumber: row.poNumber,
					poDate: row.poDate.toISOString().slice(0, 10),
					total: num(row.total),
					receivedAt: row.receivedAt.toISOString(),
					claroPoId: id,
				},
			},
		})
	})
}

/** Confirm every green PO. Only green ones: anything else is left for a look. */
export async function confirmAllGreen(
	userId: string,
): Promise<{ confirmed: number; skipped: number }> {
	const ids = await db.claroPo.findMany({
		where: { status: "READY" },
		orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
		select: { id: true },
	})
	let confirmed = 0
	let skipped = 0
	for (const { id } of ids) {
		try {
			await confirmPo(id, userId)
			confirmed++
		} catch (e) {
			if (!(e instanceof PoError)) throw e
			skipped++
		}
	}
	return { confirmed, skipped }
}

/** Counts for the tabs and the Home box. */
export async function poInboxCounts(now = new Date()) {
	const groups = await db.claroPo.groupBy({ by: ["status"], _count: true })
	const by = Object.fromEntries(groups.map((g) => [g.status, g._count]))
	const dayStart = new Date(
		`${now.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })}T00:00:00-04:00`,
	)
	const uploadedToday = await db.claroPo.count({
		where: { receivedAt: { gte: dayStart } },
	})
	const n = (k: string) => by[k] ?? 0
	return {
		reading: n("PENDING") + n("READING"),
		ready: n("READY"),
		needsLook: n("NEEDS_LOOK"),
		blocked: n("BLOCKED"),
		unmatched: n("UNMATCHED"),
		confirmed: n("CONFIRMED"),
		uploadedToday,
	}
}

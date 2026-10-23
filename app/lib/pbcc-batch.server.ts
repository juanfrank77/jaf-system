import fs from "node:fs/promises"
import { normaliseAvisoNumber, readAvisoNumber } from "~/lib/aviso-pdf.server"
import {
	areaLetter,
	bankInvoiceNumber,
	barrioFromAddress,
	contractLabel,
	jobKind,
	localityFromAddress,
	scheduleTotals,
} from "~/lib/bank-schedule"
import {
	generateScheduleXlsx,
	type ScheduleRow,
} from "~/lib/bank-schedule-xlsx.server"
import { db } from "~/lib/db.server"
import { PBCC_BATCH_CAPACITY } from "~/lib/finance-home"
import { stageWhere } from "~/lib/finance-stages.server"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import {
	type BankInvoiceLine,
	generateBankInvoicePdf,
} from "~/lib/pdf/bank-invoice.server"
import type { InvoiceLine } from "~/lib/service-lines"
import {
	getBankInvoicePrefix,
	getLcPbccAdvanceRate,
} from "~/lib/system-settings.server"
import { saveBuffer } from "~/lib/uploads.server"
import type { Prisma } from "../../generated/prisma/client"

type BatchErrorCode =
	| "not_found"
	| "empty"
	| "not_open"
	| "not_closed"
	| "already_sent"
	| "no_area"
	| "reason_required"
	| "not_in_batch"
	| "check_failed"
	| "not_eligible"

export class BatchError extends Error {
	constructor(
		public code: BatchErrorCode,
		public controlNumbers: string[] = [],
	) {
		super(`PBCC batch refused: ${code}`)
		this.name = "BatchError"
	}
}

const SUPPLIER_NUMBER = "V0000000006"
const DEBTOR = "PRT / CLARO"
/** ORG. cell on the PBCC invoice. */
const ORG = "PWOR"
/** Held while the open batch is found or created, so there is only ever one. */
const OPEN_BATCH_LOCK = 7_702_001

/** A batch's packets in row order: the order they were accepted. */
export const BATCH_ROW_ORDER = [
	{ financeVerifiedAt: "asc" },
	{ id: "asc" },
] satisfies Prisma.JafInvoiceOrderByWithRelationInput[]

/** MM/DD/YY of the Puerto Rico business-calendar day containing `d`. */
export function bankDateLabel(d: Date): string {
	return d.toLocaleDateString("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		timeZone: "America/Puerto_Rico",
	})
}

type Tx = Prisma.TransactionClient

/** What a packet bills, from the invoice record's lines (Rule 1). */
export function rowAmounts(doc: {
	jafInvoiceLines: unknown
	jafInvoiceLineTotal: unknown
}): { subtotal: number; ivu: number; total: number } {
	const lines = Array.isArray(doc.jafInvoiceLines)
		? (doc.jafInvoiceLines as InvoiceLine[])
		: []
	if (lines.length === 0) {
		const subtotal = Number(doc.jafInvoiceLineTotal ?? 0)
		return { subtotal, ivu: 0, total: subtotal }
	}
	const t = computeInvoiceTotals(lines)
	return { subtotal: t.subtotal, ivu: t.ivu, total: t.total }
}

/** Recompute the batch's total and advance from the packets it holds. */
async function refreshTotals(tx: Tx, batchId: string): Promise<void> {
	const [batch, docs] = await Promise.all([
		tx.bankSchedule.findUniqueOrThrow({
			where: { id: batchId },
			select: { advanceRate: true },
		}),
		tx.jafInvoice.findMany({
			where: { bankScheduleId: batchId },
			select: { jafInvoiceLines: true, jafInvoiceLineTotal: true },
		}),
	])
	const { total, advance } = scheduleTotals(
		docs.map((d) => rowAmounts(d).subtotal),
		Number(batch.advanceRate),
	)
	await tx.bankSchedule.update({
		where: { id: batchId },
		data: { total, advanceAmount: advance },
	})
}

/**
 * The one open batch, created when there is none. A new batch takes in the
 * accepted packets nobody has batched yet (oldest first, up to its capacity):
 * a row taken out of the last batch lands here, as does anything accepted
 * before batches existed.
 */
async function openBatchIn(tx: Tx, userId: string) {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OPEN_BATCH_LOCK})`
	const open = await tx.bankSchedule.findFirst({
		where: { closedAt: null },
		orderBy: { generatedAt: "desc" },
	})
	if (open) return open
	const rate = await getLcPbccAdvanceRate()
	const created = await tx.bankSchedule.create({
		data: {
			generatedById: userId,
			advanceRate: rate,
			total: 0,
			advanceAmount: 0,
		},
	})
	const waiting = await tx.jafInvoice.findMany({
		where: { AND: [stageWhere("LC_REQUEST"), { bankScheduleId: null }] },
		orderBy: BATCH_ROW_ORDER,
		take: PBCC_BATCH_CAPACITY,
		select: { id: true },
	})
	if (waiting.length > 0) {
		await tx.jafInvoice.updateMany({
			where: { id: { in: waiting.map((w) => w.id) } },
			data: { bankScheduleId: created.id },
		})
		await refreshTotals(tx, created.id)
	}
	return created
}

async function closeIn(tx: Tx, batchId: string, userId: string) {
	await tx.bankSchedule.update({
		where: { id: batchId },
		data: { closedAt: new Date(), closedById: userId },
	})
}

/** Today's open batch with its packets in row order, creating it if needed. */
export async function getOpenBatch(userId: string) {
	const batch = await db.$transaction((tx) => openBatchIn(tx, userId))
	return batch
}

/**
 * Accept puts the packet in the open batch as its next row. The 100th packet
 * closes the batch and the next one opens by itself. Called after the packet
 * is accepted; safe to call again for a packet already in a batch.
 */
export async function addToOpenBatch(opts: {
	docId: string
	userId: string
}): Promise<{ batchId: string; closedBatchIds: string[] }> {
	const closedBatchIds: string[] = []
	const batchId = await db.$transaction(async (tx) => {
		const full = async (id: string) =>
			(await tx.jafInvoice.count({ where: { bankScheduleId: id } })) >=
			PBCC_BATCH_CAPACITY
		let open = await openBatchIn(tx, opts.userId)
		const doc = await tx.jafInvoice.findUniqueOrThrow({
			where: { id: opts.docId },
			select: { bankScheduleId: true },
		})
		// Creating the batch may already have taken this packet in.
		if (!doc.bankScheduleId) {
			if (await full(open.id)) {
				await closeIn(tx, open.id, opts.userId)
				closedBatchIds.push(open.id)
				open = await openBatchIn(tx, opts.userId)
			}
			await tx.jafInvoice.update({
				where: { id: opts.docId },
				data: { bankScheduleId: open.id },
			})
		}
		const placedIn = doc.bankScheduleId ?? open.id
		const batch = await tx.bankSchedule.findUniqueOrThrow({
			where: { id: placedIn },
			select: { closedAt: true },
		})
		// The 100th packet closes its batch; the next one opens by itself.
		if (!batch.closedAt && (await full(placedIn))) {
			await closeIn(tx, placedIn, opts.userId)
			closedBatchIds.push(placedIn)
			await openBatchIn(tx, opts.userId)
		}
		await refreshTotals(tx, placedIn)
		return placedIn
	})
	await ensureInvoicePdfs(batchId)
	for (const id of closedBatchIds) await finalizeBatch(id)
	return { batchId, closedBatchIds }
}

/**
 * "Take out a row" on the open batch: the packet goes back to the pool and
 * lands in the next batch, never deleted. The reason is kept on its history.
 */
export async function takeOutRow(opts: {
	docId: string
	reason: string
	userId: string
}): Promise<void> {
	const reason = opts.reason.trim()
	if (!reason) throw new BatchError("reason_required")
	await db.$transaction(async (tx) => {
		const doc = await tx.jafInvoice.findUnique({
			where: { id: opts.docId },
			select: {
				controlNumber: true,
				bankScheduleId: true,
				bankSchedule: {
					select: { number: true, closedAt: true, sentAt: true },
				},
			},
		})
		if (!doc?.bankScheduleId || !doc.bankSchedule)
			throw new BatchError("not_in_batch")
		if (doc.bankSchedule.sentAt) throw new BatchError("already_sent")
		if (doc.bankSchedule.closedAt) throw new BatchError("not_open")
		await tx.jafInvoice.update({
			where: { id: opts.docId },
			data: { bankScheduleId: null },
		})
		await refreshTotals(tx, doc.bankScheduleId)
		await tx.auditTrail.create({
			data: {
				docId: opts.docId,
				userId: opts.userId,
				action: "PBCC_ROW_TAKEN_OUT",
				diffJson: {
					batchNumber: doc.bankSchedule.number,
					reason,
					source: "STAMPED",
				},
			},
		})
	})
}

/** Close the open batch early, at any count. The next batch opens by itself. */
export async function closeOpenBatch(opts: {
	batchId: string
	userId: string
}): Promise<void> {
	await db.$transaction(async (tx) => {
		const batch = await tx.bankSchedule.findUnique({
			where: { id: opts.batchId },
			include: {
				invoices: {
					select: { controlNumber: true, brigade: { select: { area: true } } },
				},
			},
		})
		if (!batch) throw new BatchError("not_found")
		if (batch.closedAt) throw new BatchError("not_open")
		if (batch.invoices.length === 0) throw new BatchError("empty")
		const noArea = batch.invoices.filter((d) => !areaLetter(d.brigade?.area))
		if (noArea.length > 0)
			throw new BatchError(
				"no_area",
				noArea.map((d) => d.controlNumber),
			)
		await closeIn(tx, opts.batchId, opts.userId)
		await openBatchIn(tx, opts.userId)
	})
	await finalizeBatch(opts.batchId)
}

type BatchDoc = Awaited<ReturnType<typeof loadBatchDocs>>[number]

async function loadBatchDocs(batchId: string) {
	return db.jafInvoice.findMany({
		where: { bankScheduleId: batchId },
		orderBy: BATCH_ROW_ORDER,
		include: {
			brigade: { select: { area: true, name: true, leadName: true } },
		},
	})
}

function invoiceLinesOf(
	doc: BatchDoc,
	byId: Map<
		string,
		{
			accountCode: string | null
			subAct: string | null
			dept: string | null
			profitCenter: string | null
			act: string | null
			costCenterCode: string | null
		}
	>,
): BankInvoiceLine[] {
	return ((doc.jafInvoiceLines as InvoiceLine[] | null) ?? []).map((l) => {
		const c = byId.get(l.serviceCodeId)
		return {
			claroCode: l.claroCode,
			description: l.name,
			qty: l.qty,
			unit: l.unit ?? "EA",
			unitPrice: l.unitPrice,
			amount: l.lineAmount,
			accountCode: c?.accountCode ?? l.accountCode ?? "",
			subAct: c?.subAct ?? "",
			dept: c?.dept ?? "",
			profitCenter: c?.profitCenter ?? "",
			act: c?.act ?? "",
			costCenter: c?.costCenterCode ?? "",
		}
	})
}

/**
 * The PBCC invoice PDF for every packet in the batch that has none yet, dated
 * the day the packet was accepted. Retried by every later step, so a failed
 * write on Accept never leaves a row without its invoice for good.
 */
async function ensureInvoicePdfs(batchId: string): Promise<void> {
	const docs = (await loadBatchDocs(batchId)).filter(
		(d) => !d.bankInvoicePdfPath,
	)
	if (docs.length === 0) return
	const [prefix, catalog] = await Promise.all([
		getBankInvoicePrefix(),
		db.serviceCode.findMany(),
	])
	const byId = new Map(catalog.map((c) => [c.id, c]))
	for (const doc of docs) {
		const aviso = doc.avisoNumber || doc.controlNumber
		const from = doc.startedAt ?? doc.fieldSubmittedAt ?? doc.createdAt
		const to = doc.endedAt ?? from
		const address = doc.jobAddressActual ?? doc.jobAddressEstimated
		const pdf = await generateBankInvoicePdf({
			supplierNumber: SUPPLIER_NUMBER,
			// The PDF's NUMERO DE FACTURA is the plain aviso, as on JAF's sample;
			// the prefixed form stays on the Excel schedule.
			avisoNumber: aviso,
			org: ORG,
			invoiceDate: bankDateLabel(doc.financeVerifiedAt ?? new Date()),
			contractLabel: contractLabel(prefix),
			workFrom: bankDateLabel(from),
			workTo: bankDateLabel(to),
			description: doc.jobDescription ?? doc.jobType,
			barrio: barrioFromAddress(address),
			locality: localityFromAddress(address),
			kind: jobKind(doc.jobType),
			lines: invoiceLinesOf(doc, byId),
			total: rowAmounts(doc).subtotal,
		})
		const pdfPath = await saveBuffer(
			"bank-invoices",
			`${doc.id}-bank-invoice.pdf`,
			pdf,
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { bankInvoicePdfPath: pdfPath },
		})
	}
}

/** Everything a closed batch needs to be checked and packaged: invoices, then the Excel. */
export async function finalizeBatch(batchId: string): Promise<void> {
	await ensureInvoicePdfs(batchId)
	const [batch, docs, prefix] = await Promise.all([
		db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }),
		loadBatchDocs(batchId),
		getBankInvoicePrefix(),
	])
	const rows: ScheduleRow[] = docs.map((doc) => ({
		invoiceDate: doc.financeVerifiedAt ?? batch.generatedAt,
		invoiceNumber: bankInvoiceNumber(
			prefix,
			doc.avisoNumber || doc.controlNumber,
		),
		area: areaLetter(doc.brigade?.area) ?? "",
		debtor: DEBTOR,
		po: "",
		amount: rowAmounts(doc).subtotal,
	}))
	const { total, advance } = scheduleTotals(
		rows.map((r) => r.amount),
		Number(batch.advanceRate),
	)
	const xlsx = await generateScheduleXlsx({
		rows,
		total,
		advance,
		date: batch.closedAt ?? new Date(),
		seller: "JAF COM",
	})
	const xlsxPath = await saveBuffer(
		"bank-schedules",
		`schedule-${batch.number}.xlsx`,
		xlsx,
	)
	await db.bankSchedule.update({
		where: { id: batchId },
		data: { xlsxPath, total, advanceAmount: advance },
	})
}

const exists = (p: string | null | undefined) =>
	p
		? fs.access(p).then(
				() => true,
				() => false,
			)
		: Promise.resolve(false)

type BatchCheck = {
	rows: number
	avisoPdfs: number
	invoicePdfs: number
	/** Rows whose Aviso file does not carry the Aviso # on the row. */
	avisoMismatches: string[]
	totalMatches: boolean
	/** Aviso #s already on a row of another batch. */
	duplicates: string[]
	noArea: string[]
	excel: boolean
	passed: boolean
}

/** W3's batch check: nothing is packaged, and nothing sent, until it is all green. */
export async function checkBatch(batchId: string): Promise<BatchCheck> {
	const [batch, docs] = await Promise.all([
		db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }),
		loadBatchDocs(batchId),
	])
	const avisoPresent = await Promise.all(
		docs.map((d) => exists(d.avisoDocPath)),
	)
	const invoicePresent = await Promise.all(
		docs.map((d) => exists(d.bankInvoicePdfPath)),
	)
	const avisoMismatches: string[] = []
	for (const [i, doc] of docs.entries()) {
		if (!avisoPresent[i] || !doc.avisoDocPath) continue
		try {
			const onFile = await readAvisoNumber(
				new Uint8Array(await fs.readFile(doc.avisoDocPath)),
			)
			if (normaliseAvisoNumber(doc.avisoNumber ?? "") !== onFile)
				avisoMismatches.push(doc.avisoNumber ?? doc.controlNumber)
		} catch {
			avisoMismatches.push(doc.avisoNumber ?? doc.controlNumber)
		}
	}
	const avisoNumbers = docs
		.map((d) => d.avisoNumber)
		.filter((n): n is string => !!n)
	const elsewhere = avisoNumbers.length
		? await db.jafInvoice.findMany({
				where: {
					avisoNumber: { in: avisoNumbers },
					bankScheduleId: { not: null, notIn: [batchId] },
				},
				select: { avisoNumber: true },
			})
		: []
	const repeatedHere = avisoNumbers.filter(
		(n, i) => avisoNumbers.indexOf(n) !== i,
	)
	const duplicates = [
		...new Set([
			...elsewhere.map((e) => e.avisoNumber as string),
			...repeatedHere,
		]),
	]
	const sum = scheduleTotals(
		docs.map((d) => rowAmounts(d).subtotal),
		Number(batch.advanceRate),
	).total
	const check: BatchCheck = {
		rows: docs.length,
		avisoPdfs: avisoPresent.filter(Boolean).length,
		invoicePdfs: invoicePresent.filter(Boolean).length,
		avisoMismatches,
		totalMatches: sum === Number(batch.total),
		duplicates,
		noArea: docs
			.filter((d) => !areaLetter(d.brigade?.area))
			.map((d) => d.controlNumber),
		excel: await exists(batch.xlsxPath),
		passed: false,
	}
	check.passed =
		check.rows > 0 &&
		check.avisoPdfs === check.rows &&
		check.invoicePdfs === check.rows &&
		check.avisoMismatches.length === 0 &&
		check.totalMatches &&
		check.duplicates.length === 0 &&
		check.noArea.length === 0 &&
		check.excel
	return check
}

/**
 * Mark sent: every packet in the closed batch is stamped Sold to PBCC (the
 * start of Monica's Arm A clock) and the batch can no longer change.
 */
export async function markBatchSent(opts: {
	batchId: string
	sentById: string
}): Promise<{ alreadySent: boolean }> {
	const batch = await db.bankSchedule.findUnique({
		where: { id: opts.batchId },
		select: { closedAt: true, sentAt: true },
	})
	if (!batch) throw new BatchError("not_found")
	if (batch.sentAt) return { alreadySent: true }
	if (!batch.closedAt) throw new BatchError("not_closed")
	if (!(await checkBatch(opts.batchId)).passed)
		throw new BatchError("check_failed")

	const comptrollers = await db.user.findMany({
		where: { role: "COMPTROLLER", active: true },
		select: { id: true },
	})
	return db.$transaction(async (tx) => {
		const packets = await tx.jafInvoice.findMany({
			where: { bankScheduleId: opts.batchId },
			select: { id: true, controlNumber: true, pbccRequestSentAt: true },
		})
		const unsent = packets.filter((p) => !p.pbccRequestSentAt)
		// A packet sent back or cancelled after it was batched must not be stamped.
		const eligible = new Set(
			(
				await tx.jafInvoice.findMany({
					where: {
						AND: [
							{ id: { in: unsent.map((p) => p.id) } },
							stageWhere("LC_REQUEST"),
						],
					},
					select: { id: true },
				})
			).map((p) => p.id),
		)
		const offenders = unsent.filter((p) => !eligible.has(p.id))
		if (offenders.length > 0)
			throw new BatchError(
				"not_eligible",
				offenders.map((p) => p.controlNumber),
			)

		const claimed = await tx.bankSchedule.updateMany({
			where: { id: opts.batchId, sentAt: null, closedAt: { not: null } },
			data: { sentAt: new Date(), sentById: opts.sentById },
		})
		if (claimed.count === 0) return { alreadySent: true }
		const now = new Date()
		const stamped = await tx.jafInvoice.updateMany({
			where: {
				AND: [
					{ bankScheduleId: opts.batchId },
					{ pbccRequestSentAt: null },
					stageWhere("LC_REQUEST"),
				],
			},
			data: { pbccRequestSentAt: now, karmenCopySentAt: now },
		})
		// The stamp carries the eligibility predicate, so a send-back or cancel
		// committed after the check above comes up short and rolls everything back.
		if (stamped.count !== unsent.length)
			throw new BatchError(
				"not_eligible",
				unsent.map((p) => p.controlNumber),
			)
		await tx.auditTrail.createMany({
			data: packets.map((p) => ({
				docId: p.id,
				userId: opts.sentById,
				action: "PBCC_REQUEST_GENERATED" as const,
				diffJson: { scheduleId: opts.batchId, source: "STAMPED" },
			})),
		})
		const full = await tx.bankSchedule.findUniqueOrThrow({
			where: { id: opts.batchId },
		})
		await tx.notification.createMany({
			data: comptrollers.map((c) => ({
				userId: c.id,
				message: `PBCC batch #${full.number} sent to PBCC (${packets.length} packets).`,
			})),
		})
		return { alreadySent: false }
	})
}

import fs from "node:fs/promises"
import { scheduleTotals } from "~/lib/bank-schedule"
import {
	generateScheduleXlsx,
	type ScheduleRow,
} from "~/lib/bank-schedule-xlsx.server"
import { db } from "~/lib/db.server"
import { zipPackage } from "~/lib/package-zip.server"
import { puertoRicoDay } from "~/lib/payroll-run.server"
import { getLcPbccAdvanceRate } from "~/lib/system-settings.server"
import { saveBuffer, saveUpload } from "~/lib/uploads.server"
import type { Prisma } from "../../generated/prisma/client"

type Tx = Prisma.TransactionClient

/** One EWIT invoice holds at most this much (Carmen's rule 4). */
export const EWIT_INVOICE_LIMIT = 5000
/** A warranty doc waiting longer than this is amber: done, but Claro has not released the PO. */
export const WARRANTY_STALE_DAYS = 14
/** Held while the open batch is found or created, so there is only ever one. */
const OPEN_EWIT_BATCH_LOCK = 7_702_002

export type EwitErrorCode =
	| "missing_number"
	| "duplicate_number"
	| "bad_total"
	| "over_limit"
	| "no_file"
	| "no_orders"
	| "order_on_invoice"
	| "not_found"
	| "batch_closed"
	| "not_open"
	| "not_closed"
	| "not_sent"
	| "empty"
	| "check_failed"
	| "no_reason"
	| "nothing_to_pay"
	| "bad_amount"
	| "undo_expired"

export class EwitError extends Error {
	constructor(
		public code: EwitErrorCode,
		public detail: string[] = [],
	) {
		super(`EWIT refused: ${code}`)
		this.name = "EwitError"
	}
}

const num = (d: Prisma.Decimal | number | null | undefined) =>
	d == null ? 0 : Number(d)
const cents = (n: number) => Math.round(n * 100) / 100

const daysSince = (from: Date, now: Date) =>
	Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000))

// ── B1 · Warranty docs ─────────────────────────────────────────────────

export type WarrantyDocRow = {
	id: string
	orderNo: string
	installerId: string
	installerName: string
	empNo: string | null
	installedAt: Date
	modem: string | null
	/** The form photo, as a `/files` path; null when the installer saved none. */
	photoPath: string | null
	daysWaiting: number
	stale: boolean
	/** The same order # was submitted more than once. */
	duplicate: boolean
}

/**
 * Every submitted installer completion that has not landed on an EWIT invoice,
 * oldest first: Carmen's digital stack of Claro forms.
 */
export async function loadWarrantyDocs(
	now: Date = new Date(),
): Promise<WarrantyDocRow[]> {
	const rows = await db.installCompletion.findMany({
		where: { status: "SUBMITTED", ewitInvoiceId: null },
		orderBy: [{ installedAt: "asc" }, { createdAt: "asc" }],
		include: {
			installer: {
				select: { id: true, name: true, installerProfile: true },
			},
		},
	})
	const seen = new Map<string, number>()
	for (const r of rows)
		seen.set(r.claroOrderNo, (seen.get(r.claroOrderNo) ?? 0) + 1)
	return rows.map((r) => {
		const installedAt = r.installedAt ?? r.submittedAt ?? r.createdAt
		const daysWaiting = daysSince(installedAt, now)
		return {
			id: r.id,
			orderNo: r.claroOrderNo,
			installerId: r.installer.id,
			installerName: r.installer.name,
			empNo: r.installer.installerProfile?.jafNumber ?? null,
			installedAt,
			modem: r.serialInstalled,
			photoPath: r.formPhotoPath,
			daysWaiting,
			stale: daysWaiting > WARRANTY_STALE_DAYS,
			duplicate: (seen.get(r.claroOrderNo) ?? 0) > 1,
		}
	})
}

// ── B2 · EWIT invoice ──────────────────────────────────────────────────

const normNumber = (s: string) => s.trim().replace(/\s+/g, "")

/** The one open installer batch, created when there is none. */
async function openBatchIn(tx: Tx, userId: string) {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OPEN_EWIT_BATCH_LOCK})`
	const open = await tx.ewitBatch.findFirst({
		where: { closedAt: null },
		orderBy: { createdAt: "desc" },
	})
	return open ?? tx.ewitBatch.create({ data: { createdById: userId } })
}

export async function getOpenEwitBatch(userId: string) {
	return db.$transaction((tx) => openBatchIn(tx, userId))
}

export async function createEwitInvoice(opts: {
	number: string
	invoiceDate: Date
	total: number
	file: File | null
	/** Warranty docs ticked on the page. */
	completionIds: string[]
	/** Order #s typed in; one with no warranty photo yet saves, flagged. */
	typedOrderNos: string[]
	userId: string
}): Promise<{ id: string; unmatched: string[] }> {
	const number = normNumber(opts.number)
	if (!number) throw new EwitError("missing_number")
	if (!Number.isFinite(opts.total) || opts.total <= 0)
		throw new EwitError("bad_total")
	if (cents(opts.total) > EWIT_INVOICE_LIMIT) throw new EwitError("over_limit")
	if (!opts.file || opts.file.size === 0) throw new EwitError("no_file")
	if (await db.ewitInvoice.findUnique({ where: { number } }))
		throw new EwitError("duplicate_number")

	const typed = [
		...new Set(opts.typedOrderNos.map((o) => o.trim()).filter(Boolean)),
	]
	const ticked = await db.installCompletion.findMany({
		where: { id: { in: opts.completionIds } },
		select: { id: true, claroOrderNo: true, ewitInvoiceId: true },
	})
	// A typed order # that matches a warranty doc takes that doc, so it leaves the list.
	const typedDocs = typed.length
		? await db.installCompletion.findMany({
				where: { claroOrderNo: { in: typed }, status: "SUBMITTED" },
				select: { id: true, claroOrderNo: true, ewitInvoiceId: true },
			})
		: []
	const docs = [
		...new Map([...ticked, ...typedDocs].map((d) => [d.id, d])).values(),
	]
	if (docs.length + typed.length === 0) throw new EwitError("no_orders")
	// One order # goes on one invoice, ever.
	const taken = docs.filter((d) => d.ewitInvoiceId).map((d) => d.claroOrderNo)
	const matchedNos = new Set(docs.map((d) => d.claroOrderNo))
	const unmatched = typed.filter((o) => !matchedNos.has(o))
	const typedElsewhere = unmatched.length
		? await db.ewitInvoice.findMany({
				where: { voidedAt: null, unmatchedOrderNos: { hasSome: unmatched } },
				select: { unmatchedOrderNos: true },
			})
		: []
	const clash = new Set([
		...taken,
		...typedElsewhere.flatMap((i) =>
			i.unmatchedOrderNos.filter((o) => unmatched.includes(o)),
		),
	])
	if (clash.size > 0) throw new EwitError("order_on_invoice", [...clash])

	const filePath = await saveUpload(
		"ewit-invoices",
		`ewit-${number.replace(/[^A-Za-z0-9._-]+/g, "_")}-${Date.now()}.pdf`,
		opts.file,
	)
	const id = await db.$transaction(async (tx) => {
		const batch = await openBatchIn(tx, opts.userId)
		const invoice = await tx.ewitInvoice.create({
			data: {
				number,
				invoiceDate: opts.invoiceDate,
				total: cents(opts.total),
				filePath,
				batchId: batch.id,
				createdById: opts.userId,
				unmatchedOrderNos: unmatched,
			},
		})
		// Conditional claim: a doc another save took a moment ago is not stolen.
		const claimed = await tx.installCompletion.updateMany({
			where: { id: { in: docs.map((d) => d.id) }, ewitInvoiceId: null },
			data: { ewitInvoiceId: invoice.id },
		})
		if (claimed.count !== docs.length)
			throw new EwitError(
				"order_on_invoice",
				docs.map((d) => d.claroOrderNo),
			)
		return invoice.id
	})
	return { id, unmatched }
}

/**
 * Take an EWIT invoice back. Before its batch is closed it is removed and its
 * row leaves the batch; once the batch is sent it is held with a reason. Either
 * way the orders return to the warranty list and nothing is deleted.
 */
export async function removeEwitInvoice(opts: {
	invoiceId: string
	userId: string
	reason: string
}): Promise<{ mode: "voided" | "held" }> {
	const reason = opts.reason.trim()
	return db.$transaction(async (tx) => {
		const inv = await tx.ewitInvoice.findUnique({
			where: { id: opts.invoiceId },
			include: { batch: true },
		})
		if (!inv || inv.voidedAt || inv.heldAt) throw new EwitError("not_found")
		const sent = Boolean(inv.batch?.sentAt)
		if (inv.batch?.closedAt && !sent) throw new EwitError("batch_closed")
		if (sent && !reason) throw new EwitError("no_reason")
		await tx.installCompletion.updateMany({
			where: { ewitInvoiceId: inv.id },
			data: { ewitInvoiceId: null },
		})
		if (sent) {
			await tx.ewitInvoice.update({
				where: { id: inv.id },
				data: { heldAt: new Date(), holdReason: reason },
			})
			return { mode: "held" as const }
		}
		await tx.ewitInvoice.update({
			where: { id: inv.id },
			data: {
				voidedAt: new Date(),
				voidedById: opts.userId,
				voidReason: reason || null,
				batchId: null,
			},
		})
		return { mode: "voided" as const }
	})
}

// ── B3 · Installer PBCC batch ──────────────────────────────────────────

const batchInvoices = (batchId: string) =>
	db.ewitInvoice.findMany({
		where: { batchId, voidedAt: null, heldAt: null },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		include: { completions: { select: { id: true } } },
	})

export type EwitBatchCheck = {
	rows: number
	pdfs: number
	excelLines: number
	overLimit: string[]
	totalMatches: boolean
	excel: boolean
	passed: boolean
}

const exists = (p: string | null | undefined) =>
	p
		? fs.access(p).then(
				() => true,
				() => false,
			)
		: Promise.resolve(false)

/** The batch check: rows = PDFs = Excel lines, each invoice within the limit, total = sum of rows. */
export async function checkEwitBatch(batchId: string): Promise<EwitBatchCheck> {
	const [batch, invoices] = await Promise.all([
		db.ewitBatch.findUnique({ where: { id: batchId } }),
		batchInvoices(batchId),
	])
	if (!batch) throw new EwitError("not_found")
	const pdfs = (
		await Promise.all(invoices.map((i) => exists(i.filePath)))
	).filter(Boolean).length
	const excel = await exists(batch.xlsxPath)
	const overLimit = invoices
		.filter((i) => num(i.total) > EWIT_INVOICE_LIMIT)
		.map((i) => i.number)
	// The Excel is written from these same rows when the batch closes.
	const excelLines = excel ? invoices.length : 0
	const totalMatches =
		excel &&
		batch.total != null &&
		cents(num(batch.total)) ===
			cents(invoices.reduce((s, i) => s + num(i.total), 0))
	return {
		rows: invoices.length,
		pdfs,
		excelLines,
		overLimit,
		totalMatches,
		excel,
		passed:
			invoices.length > 0 &&
			pdfs === invoices.length &&
			excel &&
			excelLines === invoices.length &&
			overLimit.length === 0 &&
			totalMatches,
	}
}

export async function closeEwitBatch(opts: {
	batchId: string
	userId: string
}): Promise<void> {
	await db.$transaction(async (tx) => {
		const batch = await tx.ewitBatch.findUnique({ where: { id: opts.batchId } })
		if (!batch) throw new EwitError("not_found")
		if (batch.closedAt) throw new EwitError("not_open")
		const count = await tx.ewitInvoice.count({
			where: { batchId: opts.batchId, voidedAt: null, heldAt: null },
		})
		if (count === 0) throw new EwitError("empty")
		const top = await tx.ewitBatch.aggregate({ _max: { number: true } })
		await tx.ewitBatch.update({
			where: { id: opts.batchId },
			data: {
				number: (top._max.number ?? 0) + 1,
				closedAt: new Date(),
				closedById: opts.userId,
			},
		})
		// The next invoice lands in a fresh open batch.
		await tx.ewitBatch.create({ data: { createdById: opts.userId } })
	})
	await writeEwitExcel(opts.batchId)
}

/** The same Excel template as Lissette's batch; one line per EWIT invoice. */
export async function writeEwitExcel(batchId: string): Promise<void> {
	const [batch, invoices, rate] = await Promise.all([
		db.ewitBatch.findUniqueOrThrow({ where: { id: batchId } }),
		batchInvoices(batchId),
		getLcPbccAdvanceRate(),
	])
	const rows: ScheduleRow[] = invoices.map((i) => ({
		invoiceDate: i.invoiceDate,
		invoiceNumber: i.number,
		area: "",
		debtor: "PRT / CLARO",
		po: `${i.completions.length + i.unmatchedOrderNos.length} orders`,
		amount: num(i.total),
	}))
	const { total, advance } = scheduleTotals(
		rows.map((r) => r.amount),
		rate,
	)
	const xlsx = await generateScheduleXlsx({
		rows,
		total,
		advance,
		date: batch.closedAt ?? new Date(),
		seller: "JAF COM",
	})
	const xlsxPath = await saveBuffer(
		"ewit-batches",
		`installers-${batch.number ?? batch.id}.xlsx`,
		xlsx,
	)
	await db.ewitBatch.update({
		where: { id: batchId },
		data: { xlsxPath, total },
	})
}

/** The Excel and every EWIT PDF, named by row, as one zip: what Carmen emails PBCC. */
export async function buildEwitPackage(batchId: string): Promise<{
	zip: Buffer
	name: string
}> {
	const batch = await db.ewitBatch.findUnique({ where: { id: batchId } })
	if (!batch) throw new EwitError("not_found")
	if (!batch.closedAt || !batch.xlsxPath) throw new EwitError("not_closed")
	if (!(await checkEwitBatch(batchId)).passed)
		throw new EwitError("check_failed")
	const invoices = await batchInvoices(batchId)
	const files = [
		{ name: `installers-${batch.number}.xlsx`, path: batch.xlsxPath },
		...invoices.map((i, n) => ({
			name: `${String(n + 1).padStart(3, "0")}-${i.number}.pdf`,
			path: i.filePath,
		})),
	]
	return {
		zip: await zipPackage(files),
		name: `JAF_Installers_PBCC_${batch.number}.zip`,
	}
}

export async function markEwitBatchSent(opts: {
	batchId: string
	userId: string
}): Promise<{ alreadySent: boolean }> {
	const batch = await db.ewitBatch.findUnique({ where: { id: opts.batchId } })
	if (!batch) throw new EwitError("not_found")
	if (batch.sentAt) return { alreadySent: true }
	if (!batch.closedAt) throw new EwitError("not_closed")
	if (!(await checkEwitBatch(opts.batchId)).passed)
		throw new EwitError("check_failed")
	const claimed = await db.ewitBatch.updateMany({
		where: { id: opts.batchId, sentAt: null, closedAt: { not: null } },
		data: { sentAt: new Date(), sentById: opts.userId },
	})
	return { alreadySent: claimed.count === 0 }
}

// ── B4 · PBCC statement ────────────────────────────────────────────────

/**
 * PBCC's email lists the EWIT invoices it funded. Carmen attaches the statement
 * and ticks them; every ticked invoice, and so every order on it, is received.
 * An invoice left unticked stays waiting on PBCC.
 */
export async function receiveStatement(opts: {
	batchId: string
	receivedAt: Date
	amount: number
	file: File | null
	invoiceIds: string[]
	userId: string
}): Promise<void> {
	if (!Number.isFinite(opts.amount) || opts.amount <= 0)
		throw new EwitError("bad_amount")
	if (!opts.file || opts.file.size === 0) throw new EwitError("no_file")
	const batch = await db.ewitBatch.findUnique({ where: { id: opts.batchId } })
	if (!batch) throw new EwitError("not_found")
	if (!batch.sentAt) throw new EwitError("not_sent")
	const statementPath = await saveUpload(
		"pbcc-statements",
		`statement-${batch.number ?? batch.id}-${Date.now()}.pdf`,
		opts.file,
	)
	await db.$transaction(async (tx) => {
		await tx.ewitInvoice.updateMany({
			where: {
				id: { in: opts.invoiceIds },
				batchId: opts.batchId,
				receivedAt: null,
				voidedAt: null,
				heldAt: null,
			},
			data: { receivedAt: opts.receivedAt },
		})
		await tx.ewitBatch.update({
			where: { id: opts.batchId },
			data: {
				receivedAt: opts.receivedAt,
				// A second statement for the same batch adds to what PBCC has paid so far.
				receivedAmount: cents(num(batch.receivedAmount) + opts.amount),
				receivedById: opts.userId,
				statementPath,
			},
		})
	})
}

// ── B5 · Installer pay ─────────────────────────────────────────────────

export type InstallerPayRow = {
	installerId: string
	installerName: string
	empNo: string | null
	jobs: number
	orders: string[]
}

/** Orders PBCC has paid for and nobody has paid the installer for yet, by installer. */
export async function loadInstallerPayList(): Promise<InstallerPayRow[]> {
	const jobs = await db.installCompletion.findMany({
		where: {
			installerPaymentId: null,
			ewitInvoice: {
				receivedAt: { not: null },
				voidedAt: null,
				heldAt: null,
			},
		},
		orderBy: { claroOrderNo: "asc" },
		include: {
			installer: { select: { id: true, name: true, installerProfile: true } },
		},
	})
	const byInstaller = new Map<string, InstallerPayRow>()
	for (const j of jobs) {
		const row = byInstaller.get(j.installerId) ?? {
			installerId: j.installerId,
			installerName: j.installer.name,
			empNo: j.installer.installerProfile?.jafNumber ?? null,
			jobs: 0,
			orders: [],
		}
		row.jobs += 1
		row.orders.push(j.claroOrderNo)
		byInstaller.set(j.installerId, row)
	}
	return [...byInstaller.values()].sort((a, b) =>
		a.installerName.localeCompare(b.installerName),
	)
}

/**
 * Tick installers paid: one payment per installer for the amount Carmen paid in
 * WinPay, stamped on every order of theirs that PBCC has paid for. An order with
 * every date filled is closed.
 */
export async function payInstallers(opts: {
	items: { installerId: string; amount: number }[]
	paidAt: Date
	userId: string
}): Promise<{ paid: number }> {
	if (opts.items.length === 0) throw new EwitError("nothing_to_pay")
	for (const i of opts.items)
		if (!Number.isFinite(i.amount) || i.amount <= 0)
			throw new EwitError("bad_amount", [i.installerId])
	let paid = 0
	await db.$transaction(async (tx) => {
		for (const item of opts.items) {
			const jobs = await tx.installCompletion.findMany({
				where: {
					installerId: item.installerId,
					installerPaymentId: null,
					ewitInvoice: {
						receivedAt: { not: null },
						voidedAt: null,
						heldAt: null,
					},
				},
				select: { id: true },
			})
			// Someone else ticked them a moment ago: nothing left to pay.
			if (jobs.length === 0) continue
			const payment = await tx.installerPayment.create({
				data: {
					installerId: item.installerId,
					paidAt: opts.paidAt,
					amount: cents(item.amount),
					paidById: opts.userId,
				},
			})
			await tx.installCompletion.updateMany({
				where: { id: { in: jobs.map((j) => j.id) }, installerPaymentId: null },
				data: { installerPaymentId: payment.id },
			})
			paid += 1
		}
	})
	if (paid === 0) throw new EwitError("nothing_to_pay")
	return { paid }
}

/** Take back a tick the same Puerto Rico day, with a reason; the orders go back on the pay list. */
export async function undoInstallerPayment(opts: {
	paymentId: string
	reason: string
	now?: Date
}): Promise<void> {
	const reason = opts.reason.trim()
	if (!reason) throw new EwitError("no_reason")
	const now = opts.now ?? new Date()
	await db.$transaction(async (tx) => {
		const pay = await tx.installerPayment.findUnique({
			where: { id: opts.paymentId },
		})
		if (!pay || pay.undoneAt) throw new EwitError("not_found")
		if (puertoRicoDay(pay.createdAt) !== puertoRicoDay(now))
			throw new EwitError("undo_expired")
		await tx.installCompletion.updateMany({
			where: { installerPaymentId: pay.id },
			data: { installerPaymentId: null },
		})
		await tx.installerPayment.update({
			where: { id: pay.id },
			data: { undoneAt: now, undoReason: reason },
		})
	})
}

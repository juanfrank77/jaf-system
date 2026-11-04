import { createHash, randomUUID } from "node:crypto"
import { extractText } from "unpdf"
import { type AdviceRead, parseAdvice } from "~/lib/advice-parse"
import { db } from "~/lib/db.server"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { ocrPdfPasses } from "~/lib/po-reader.server"
import { saveBuffer } from "~/lib/uploads.server"
import type { AdviceResult } from "../../generated/prisma/client"

type AdviceErrorCode =
	| "not_pdf"
	| "unreadable"
	| "date_missing"
	| "duplicate"
	| "total_mismatch"
	| "already_applied"
	| "not_found"
	| "not_short"
	| "reason_required"
	| "invoice_not_found"
	| "line_not_unmatched"

export class AdviceError extends Error {
	constructor(readonly code: AdviceErrorCode) {
		super(code)
		this.name = "AdviceError"
	}
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (d: { toString(): string } | null | undefined) =>
	d === null || d === undefined ? null : Number(d.toString())
/** "M19-3423", "M193423" or a bare "3423" -> 3423. */
const seqOf = (ref: string) =>
	Number(/M\s?19\s?-?\s?(\d+)/i.exec(ref)?.[1] ?? ref.replace(/\D/g, ""))

/** Text layer first; a scan is read with OCR and the pass that found the most rows wins. */
async function readAdvice(bytes: Uint8Array): Promise<AdviceRead> {
	const { text } = await extractText(bytes.slice(), { mergePages: true })
	const direct = parseAdvice(text)
	if (direct.rows.length > 0) return direct
	let best = direct
	for (const pass of await ocrPdfPasses(bytes)) {
		const r = parseAdvice(pass)
		if (r.rows.length > best.rows.length) best = r
	}
	return best
}

/** An invoice is closed when it is paid in full, or its short pay was accepted with a reason. */
function invoiceClosed(inv: {
	total: unknown
	paidAt: Date | null
	paidNet: unknown
	shortAcceptedAt: Date | null
}): boolean {
	if (!inv.paidAt) return false
	return (
		inv.shortAcceptedAt !== null ||
		r2(num(inv.paidNet as never) ?? 0) >= r2(num(inv.total as never) ?? 0)
	)
}

async function matchRow(
	ref: string,
	net: number,
): Promise<{ result: AdviceResult; invoiceId: string | null }> {
	const seq = seqOf(ref)
	const inv = Number.isInteger(seq)
		? await db.claroInvoice.findUnique({ where: { seq } })
		: null
	if (!inv) return { result: "UNMATCHED", invoiceId: null }
	if (inv.paidAt) return { result: "ALREADY_PAID", invoiceId: inv.id }
	return {
		result: r2(net) < r2(Number(inv.total)) ? "SHORT" : "MATCHED",
		invoiceId: inv.id,
	}
}

/** Read an uploaded advice and keep every row, matched or not. Nothing is applied yet. */
export async function ingestAdvice(
	file: { name: string; bytes: Uint8Array },
	userId: string,
): Promise<{ id: string }> {
	if (Buffer.from(file.bytes.subarray(0, 5)).toString() !== "%PDF-")
		throw new AdviceError("not_pdf")
	const fileHash = createHash("sha256").update(file.bytes).digest("hex")
	if (await db.paymentAdvice.findUnique({ where: { fileHash } }))
		throw new AdviceError("duplicate")
	const read = await readAdvice(file.bytes)
	if (read.rows.length === 0) throw new AdviceError("unreadable")
	if (!read.adviceDate) throw new AdviceError("date_missing")
	const rowsTotal = r2(read.rows.reduce((s, r) => s + r.net, 0))
	const total = read.total ?? rowsTotal
	// The same advice saved as a different file: same date, reference and total.
	if (
		read.reference &&
		(await db.paymentAdvice.findFirst({
			where: {
				reference: read.reference,
				adviceDate: new Date(`${read.adviceDate}T12:00:00Z`),
				total,
			},
		}))
	)
		throw new AdviceError("duplicate")

	const matched = await Promise.all(
		read.rows.map((r) => matchRow(r.invoiceRef, r.net)),
	)
	const filePath = await saveBuffer(
		"payment-advice",
		`${randomUUID()}.pdf`,
		Buffer.from(file.bytes),
	)
	const advice = await db.paymentAdvice.create({
		data: {
			adviceDate: new Date(`${read.adviceDate}T12:00:00Z`),
			bank: read.bank,
			reference: read.reference,
			total,
			rowsTotal,
			fileName: file.name.slice(0, 200),
			filePath,
			fileHash,
			uploadedById: userId,
			lines: {
				create: read.rows.map((r, i) => ({
					position: i,
					invoiceRef: r.invoiceRef,
					voucher: r.voucher,
					invoiceDate: r.invoiceDate
						? new Date(`${r.invoiceDate}T12:00:00Z`)
						: null,
					amount: r.amount,
					withholding: r.withholding,
					discount: r.discount,
					net: r.net,
					result: matched[i].result,
					invoiceId: matched[i].invoiceId,
				})),
			},
		},
		select: { id: true },
	})
	return advice
}

/**
 * When every PO on the Aviso has a closed invoice and the POs add up to what
 * JAF billed, Arm B is closed.
 */
async function tryCloseAviso(docId: string, userId: string) {
	const doc = await db.jafInvoice.findUnique({
		where: { id: docId },
		select: { receivableClosedAt: true, jafInvoiceLines: true },
	})
	if (!doc || doc.receivableClosedAt) return
	const pos = await db.claroPo.findMany({
		where: { docId, status: "CONFIRMED" },
		include: { invoice: true },
	})
	if (
		pos.length === 0 ||
		pos.some((p) => !p.invoice || !invoiceClosed(p.invoice))
	)
		return
	const lines = Array.isArray(doc.jafInvoiceLines)
		? (doc.jafInvoiceLines as { qty: number; unitPrice: number }[])
		: []
	const billed = computeInvoiceTotals(lines).subtotal
	const poed = r2(pos.reduce((s, p) => s + (num(p.subtotal) ?? 0), 0))
	if (poed < r2(billed)) return
	await db.$transaction([
		db.jafInvoice.update({
			where: { id: docId },
			data: { receivableClosedAt: new Date() },
		}),
		db.auditTrail.create({
			data: {
				docId,
				userId,
				action: "ARM_B_CLOSED",
				diffJson: { source: "STAMPED", billed, poed },
			},
		}),
	])
}

async function applyLine(
	line: {
		id: string
		invoiceId: string | null
		net: unknown
		voucher: string | null
	},
	advice: { adviceDate: Date; reference: string | null },
	userId: string,
) {
	if (!line.invoiceId) return
	const inv = await db.claroInvoice.update({
		where: { id: line.invoiceId },
		data: {
			paidAt: advice.adviceDate,
			paidNet: line.net as never,
			voucherId: line.voucher,
			bankReference: advice.reference,
		},
	})
	await db.adviceLine.update({
		where: { id: line.id },
		data: { appliedAt: new Date() },
	})
	await db.auditTrail.create({
		data: {
			docId: inv.docId,
			userId,
			action: "CLARO_PAID",
			diffJson: {
				// The paid date is read off the advice, not typed (Rule 4).
				source: "FROM_DOCUMENT",
				invoice: `M19-${inv.seq}`,
				paidAt: advice.adviceDate.toISOString().slice(0, 10),
				net: num(line.net as never),
				voucher: line.voucher,
				reference: advice.reference,
			},
		},
	})
	await tryCloseAviso(inv.docId, userId)
}

/** Apply the advice: matched and short rows are paid; unmatched rows stay for linking. */
export async function applyAdvice(adviceId: string, userId: string) {
	const advice = await db.paymentAdvice.findUnique({
		where: { id: adviceId },
		include: { lines: true },
	})
	if (!advice) throw new AdviceError("not_found")
	if (advice.appliedAt) throw new AdviceError("already_applied")
	if (r2(Number(advice.rowsTotal)) !== r2(Number(advice.total)))
		throw new AdviceError("total_mismatch")
	// Claim first so a double click cannot pay twice.
	const claimed = await db.paymentAdvice.updateMany({
		where: { id: adviceId, appliedAt: null },
		data: { appliedAt: new Date(), appliedById: userId },
	})
	if (claimed.count === 0) throw new AdviceError("already_applied")
	for (const line of advice.lines) {
		if (line.result === "MATCHED" || line.result === "SHORT")
			await applyLine(line, advice, userId)
	}
}

/** Point an unmatched row at an invoice by number; on an applied advice it is paid at once. */
export async function linkLine(
	lineId: string,
	invoiceNumber: string,
	userId: string,
) {
	const line = await db.adviceLine.findUnique({
		where: { id: lineId },
		include: { advice: true },
	})
	if (!line) throw new AdviceError("not_found")
	if (line.result !== "UNMATCHED") throw new AdviceError("line_not_unmatched")
	const seq = seqOf(invoiceNumber)
	const inv = Number.isInteger(seq)
		? await db.claroInvoice.findUnique({ where: { seq } })
		: null
	if (!inv) throw new AdviceError("invoice_not_found")
	const m = await matchRow(`M19-${inv.seq}`, Number(line.net))
	await db.adviceLine.update({
		where: { id: lineId },
		data: { result: m.result, invoiceId: inv.id },
	})
	if (line.advice.appliedAt && (m.result === "MATCHED" || m.result === "SHORT"))
		await applyLine({ ...line, invoiceId: inv.id }, line.advice, userId)
}

/** Lissette accepts a short pay, with a reason, and that closes the invoice. */
export async function acceptShort(
	invoiceId: string,
	reason: string,
	userId: string,
) {
	const why = reason.trim()
	if (!why) throw new AdviceError("reason_required")
	const inv = await db.claroInvoice.findUnique({ where: { id: invoiceId } })
	if (!inv || !inv.paidAt || inv.shortAcceptedAt)
		throw new AdviceError("not_short")
	if (r2(num(inv.paidNet) ?? 0) >= r2(Number(inv.total)))
		throw new AdviceError("not_short")
	await db.claroInvoice.update({
		where: { id: invoiceId },
		data: {
			shortReason: why,
			shortAcceptedAt: new Date(),
			shortAcceptedById: userId,
		},
	})
	await db.auditTrail.create({
		data: {
			docId: inv.docId,
			userId,
			action: "SHORT_PAY_ACCEPTED",
			diffJson: {
				source: "ENTERED",
				invoice: `M19-${inv.seq}`,
				difference: r2(Number(inv.total) - (num(inv.paidNet) ?? 0)),
				reason: why,
			},
		},
	})
	await tryCloseAviso(inv.docId, userId)
}

export async function adviceFile(id: string) {
	return db.paymentAdvice.findUnique({
		where: { id },
		select: { filePath: true, fileName: true },
	})
}

/** Counts for the tabs. */
export async function adviceCounts() {
	const [pending, applied, unmatched] = await Promise.all([
		db.paymentAdvice.count({ where: { appliedAt: null } }),
		db.paymentAdvice.count({ where: { appliedAt: { not: null } } }),
		db.adviceLine.count({ where: { result: "UNMATCHED" } }),
	])
	return { pending, applied, unmatched }
}

export async function listAdvices(applied: boolean) {
	const rows = await db.paymentAdvice.findMany({
		where: { appliedAt: applied ? { not: null } : null },
		orderBy: [{ adviceDate: "desc" }, { uploadedAt: "desc" }],
		take: 50,
		include: {
			lines: {
				orderBy: { position: "asc" },
				include: {
					invoice: {
						select: {
							id: true,
							total: true,
							paidNet: true,
							shortAcceptedAt: true,
							paidAt: true,
						},
					},
				},
			},
		},
	})
	return rows.map((a) => ({
		id: a.id,
		adviceDate: a.adviceDate.toISOString(),
		bank: a.bank,
		reference: a.reference,
		total: Number(a.total),
		rowsTotal: Number(a.rowsTotal),
		totalOk: r2(Number(a.total)) === r2(Number(a.rowsTotal)),
		applied: a.appliedAt !== null,
		lines: a.lines.map((l) => ({
			id: l.id,
			invoiceRef: l.invoiceRef,
			voucher: l.voucher,
			invoiceDate: l.invoiceDate?.toISOString() ?? null,
			net: Number(l.net),
			ourTotal: l.invoice ? Number(l.invoice.total) : null,
			result: l.result,
			invoiceId: l.invoiceId,
			/** Short paid and not yet accepted. */
			needsAccept:
				l.result === "SHORT" &&
				a.appliedAt !== null &&
				l.invoice?.shortAcceptedAt === null,
		})),
	}))
}

export async function listUnmatched() {
	const rows = await db.adviceLine.findMany({
		where: { result: "UNMATCHED" },
		orderBy: [{ advice: { adviceDate: "desc" } }, { position: "asc" }],
		take: 200,
		include: { advice: { select: { adviceDate: true, reference: true } } },
	})
	return rows.map((l) => ({
		id: l.id,
		invoiceRef: l.invoiceRef,
		voucher: l.voucher,
		net: Number(l.net),
		adviceDate: l.advice.adviceDate.toISOString(),
		reference: l.advice.reference,
	}))
}

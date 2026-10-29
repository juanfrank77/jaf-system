import { createHash, randomUUID } from "node:crypto"
import { extractText } from "unpdf"
import { type AdviceRead, isOtherJafRef, parseAdvice } from "~/lib/advice-parse"
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
	| "not_ja_line"

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

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100)

type Match = {
	result: AdviceResult
	invoiceId: string | null
	ewitInvoiceId: string | null
}

/** A JA row matches Carmen's installer invoice by number, against what Claro owes (claroTotal). */
async function matchJaRow(ref: string, net: number): Promise<Match> {
	const none: Match = {
		result: "UNMATCHED",
		invoiceId: null,
		ewitInvoiceId: null,
	}
	const number = ref.replace(/[^a-z0-9]/gi, "").toUpperCase() // canonical, as stored
	const inv = await db.ewitInvoice.findUnique({ where: { number } })
	if (!inv || inv.voidedAt || inv.heldAt || inv.claroTotal === null) return none
	const base = { invoiceId: null, ewitInvoiceId: inv.id }
	if (inv.claroPaidAt) return { ...base, result: "ALREADY_PAID" }
	return {
		...base,
		result: cents(net) < cents(Number(inv.claroTotal)) ? "SHORT" : "MATCHED",
	}
}

async function matchRow(ref: string, net: number): Promise<Match> {
	if (isOtherJafRef(ref)) return matchJaRow(ref, net)
	const seq = seqOf(ref)
	const inv = Number.isInteger(seq)
		? await db.claroInvoice.findUnique({ where: { seq } })
		: null
	if (!inv) return { result: "UNMATCHED", invoiceId: null, ewitInvoiceId: null }
	if (inv.paidAt)
		return { result: "ALREADY_PAID", invoiceId: inv.id, ewitInvoiceId: null }
	return {
		result: r2(net) < r2(Number(inv.total)) ? "SHORT" : "MATCHED",
		invoiceId: inv.id,
		ewitInvoiceId: null,
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
					ewitInvoiceId: matched[i].ewitInvoiceId,
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
		ewitInvoiceId?: string | null
		net: unknown
		voucher: string | null
	},
	advice: { adviceDate: Date; reference: string | null },
	userId: string,
) {
	if (line.ewitInvoiceId) {
		// Carmen's installer invoice: no ClaroInvoice, no Aviso, no M19 audit entry.
		// Only an unpaid, live invoice: a second advice naming it must not overwrite.
		const paid = await db.ewitInvoice.updateMany({
			where: {
				id: line.ewitInvoiceId,
				claroPaidAt: null,
				voidedAt: null,
				heldAt: null,
			},
			data: {
				claroPaidAt: advice.adviceDate,
				claroPaidNet: line.net as never,
				claroBankRef: advice.reference,
			},
		})
		if (paid.count === 0) {
			// Not payable any more: flag the row and leave it unapplied.
			await db.adviceLine.update({
				where: { id: line.id },
				data: { result: "ALREADY_PAID" },
			})
			return
		}
		await db.adviceLine.update({
			where: { id: line.id },
			data: { appliedAt: new Date() },
		})
		return
	}
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

/**
 * Re-run the JA matcher over JA rows that found no invoice on an advice still
 * waiting to be applied: Carmen may have added the PO (so claroTotal exists) or
 * the invoice itself after the upload. Returns how many rows found their invoice.
 */
export async function rematchJaLines(): Promise<number> {
	const lines = await db.adviceLine.findMany({
		where: {
			result: "UNMATCHED",
			advice: { appliedAt: null },
			invoiceRef: { startsWith: "JA", mode: "insensitive" },
		},
	})
	let found = 0
	for (const l of lines) {
		const m = await matchJaRow(l.invoiceRef, Number(l.net))
		if (m.result === "UNMATCHED") continue
		const done = await db.adviceLine.updateMany({
			where: { id: l.id, result: "UNMATCHED", advice: { appliedAt: null } },
			data: { result: m.result, ewitInvoiceId: m.ewitInvoiceId },
		})
		found += done.count
	}
	return found
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
	// A JA row is Carmen's installer invoice: never link it to an M19 invoice.
	if (isOtherJafRef(line.invoiceRef))
		throw new AdviceError("line_not_unmatched")
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
	if (!inv) throw new AdviceError("not_short")
	if (!inv.paidAt || inv.shortAcceptedAt) throw new AdviceError("not_short")
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

/** Carmen accepts a short Claro payment on an installer (JA) invoice; the reason is required. */
export async function acceptJaShort(
	lineId: string,
	reason: string,
	userId: string,
) {
	const why = reason.trim()
	if (!why) throw new AdviceError("reason_required")
	const line = await db.adviceLine.findUnique({
		where: { id: lineId },
		include: { ewitInvoice: true },
	})
	const inv = line?.ewitInvoice
	if (!line || !inv) throw new AdviceError("not_found")
	if (!isOtherJafRef(line.invoiceRef)) throw new AdviceError("not_ja_line")
	if (
		!inv.claroPaidAt ||
		inv.shortAcceptedAt ||
		inv.claroTotal === null ||
		r2(num(inv.claroPaidNet) ?? 0) >= r2(Number(inv.claroTotal))
	)
		throw new AdviceError("not_short")
	// Claim first so a double click cannot overwrite the first reason.
	const done = await db.ewitInvoice.updateMany({
		where: { id: inv.id, shortAcceptedAt: null },
		data: {
			shortAcceptedAt: new Date(),
			shortAcceptedReason: why,
			shortAcceptedById: userId,
		},
	})
	if (done.count === 0) throw new AdviceError("not_short")
}

export async function adviceFile(id: string) {
	return db.paymentAdvice.findUnique({
		where: { id },
		select: { filePath: true, fileName: true },
	})
}

/** Which desk is looking: Lissette's M19 invoices, or Carmen's JA installer invoices. */
export type AdviceKind = "m19" | "ja"

const JA_LINE = {
	invoiceRef: { startsWith: "JA", mode: "insensitive" as const },
}
const lineKind = (kind: AdviceKind) =>
	kind === "ja" ? JA_LINE : { NOT: JA_LINE }

/** Counts for the tabs, for one desk's rows. */
export async function adviceCounts(kind: AdviceKind = "m19") {
	const has = { lines: { some: lineKind(kind) } }
	const [pending, applied, unmatched] = await Promise.all([
		db.paymentAdvice.count({ where: { appliedAt: null, ...has } }),
		db.paymentAdvice.count({ where: { appliedAt: { not: null }, ...has } }),
		db.adviceLine.count({ where: { result: "UNMATCHED", ...lineKind(kind) } }),
	])
	return { pending, applied, unmatched }
}

/** Advices that carry rows for this desk, showing only that desk's rows. */
export async function listAdvices(applied: boolean, kind: AdviceKind = "m19") {
	const rows = await db.paymentAdvice.findMany({
		where: {
			appliedAt: applied ? { not: null } : null,
			lines: { some: lineKind(kind) },
		},
		orderBy: [{ adviceDate: "desc" }, { uploadedAt: "desc" }],
		take: 50,
		include: {
			lines: {
				where: lineKind(kind),
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
					ewitInvoice: {
						select: {
							claroTotal: true,
							claroPaidAt: true,
							claroPaidNet: true,
							shortAcceptedAt: true,
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
		lines: a.lines.map((l) => {
			const e = l.ewitInvoice
			return {
				id: l.id,
				invoiceRef: l.invoiceRef,
				voucher: l.voucher,
				invoiceDate: l.invoiceDate?.toISOString() ?? null,
				net: Number(l.net),
				// What Claro owes: the M19 total, or the installer invoice + IVU.
				ourTotal: e
					? num(e.claroTotal)
					: l.invoice
						? Number(l.invoice.total)
						: null,
				result: l.result,
				otherJaf: isOtherJafRef(l.invoiceRef),
				invoiceId: l.invoiceId,
				/** Short paid and not yet accepted. */
				needsAccept: e
					? l.result === "SHORT" &&
						e.claroPaidAt !== null &&
						e.shortAcceptedAt === null &&
						r2(num(e.claroPaidNet) ?? 0) < r2(num(e.claroTotal) ?? 0)
					: l.result === "SHORT" &&
						a.appliedAt !== null &&
						l.invoice?.shortAcceptedAt === null,
			}
		}),
	}))
}

export async function listUnmatched(kind: AdviceKind = "m19") {
	const rows = await db.adviceLine.findMany({
		where: { result: "UNMATCHED", ...lineKind(kind) },
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

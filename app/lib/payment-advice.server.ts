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

/** "ja-1616328" -> "JA1616328": the canonical form installer invoices are stored in. */
const jaNumber = (ref: string) => ref.replace(/[^a-z0-9]/gi, "").toUpperCase()

type JaInvoiceForMatch = {
	id: string
	voidedAt: Date | null
	heldAt: Date | null
	claroTotal: unknown
	claroPaidAt: Date | null
}

const NO_MATCH: Match = {
	result: "UNMATCHED",
	invoiceId: null,
	ewitInvoiceId: null,
}

/** What a JA row of `net` is against this installer invoice (or none). */
function jaMatch(inv: JaInvoiceForMatch | null, net: number): Match {
	if (!inv || inv.voidedAt || inv.heldAt || inv.claroTotal === null)
		return NO_MATCH
	const base = { invoiceId: null, ewitInvoiceId: inv.id }
	if (inv.claroPaidAt) return { ...base, result: "ALREADY_PAID" }
	return {
		...base,
		result: cents(net) < cents(Number(inv.claroTotal)) ? "SHORT" : "MATCHED",
	}
}

/** A JA row matches Carmen's installer invoice by number, against what Claro owes (claroTotal). */
async function matchJaRow(ref: string, net: number): Promise<Match> {
	const inv = await db.ewitInvoice.findUnique({
		where: { number: jaNumber(ref) },
	})
	return jaMatch(inv, net)
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
		invoiceRef: string
		invoiceId: string | null
		ewitInvoiceId?: string | null
		net: unknown
		voucher: string | null
	},
	advice: { adviceDate: Date; reference: string | null },
	userId: string,
) {
	if (isOtherJafRef(line.invoiceRef)) {
		// A JA row only ever pays Carmen's installer invoice, never an M19 one.
		if (!line.ewitInvoiceId) return
		const ewitInvoiceId = line.ewitInvoiceId
		// Carmen's installer invoice: no ClaroInvoice, no Aviso, no M19 audit entry.
		// The row claim and the payment are one transaction: a crash cannot leave
		// "paid but row unapplied", and only the call that owns the claim may flag it.
		await db.$transaction(async (tx) => {
			const claim = await tx.adviceLine.updateMany({
				where: { id: line.id, appliedAt: null },
				data: { appliedAt: new Date() },
			})
			if (claim.count === 0) return
			// Only an unpaid, live invoice: a second advice naming it must not overwrite.
			const paid = await tx.ewitInvoice.updateMany({
				where: {
					id: ewitInvoiceId,
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
			if (paid.count === 0)
				// Not payable any more: flag the row and leave it unapplied.
				await tx.adviceLine.update({
					where: { id: line.id },
					data: { result: "ALREADY_PAID", appliedAt: null },
				})
		})
		return
	}
	if (!line.invoiceId) return
	const invoiceId = line.invoiceId
	// Claim the row, pay the invoice and write the audit entry as one unit, so a
	// double submit cannot pay twice and a crash cannot leave a half-applied row.
	const inv = await db.$transaction(async (tx) => {
		const claim = await tx.adviceLine.updateMany({
			where: { id: line.id, appliedAt: null },
			data: { appliedAt: new Date() },
		})
		if (claim.count === 0) return null
		const paid = await tx.claroInvoice.update({
			where: { id: invoiceId },
			data: {
				paidAt: advice.adviceDate,
				paidNet: line.net as never,
				voucherId: line.voucher,
				bankReference: advice.reference,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: paid.docId,
				userId,
				action: "CLARO_PAID",
				diffJson: {
					// The paid date is read off the advice, not typed (Rule 4).
					source: "FROM_DOCUMENT",
					invoice: `M19-${paid.seq}`,
					paidAt: advice.adviceDate.toISOString().slice(0, 10),
					net: num(line.net as never),
					voucher: line.voucher,
					reference: advice.reference,
				},
			},
		})
		return paid
	})
	if (!inv) return
	await tryCloseAviso(inv.docId, userId)
}

/**
 * Re-run the JA matcher over JA rows that found no invoice: Carmen may have
 * added the PO (so claroTotal exists) or the invoice itself after the upload.
 * A row found on an advice Carmen's desk is already done with (the advice is
 * stamped applied, or her other rows on it were paid) is paid at once, the way
 * linkLine pays an M19 row, so it never waits for another Apply click.
 * Returns how many rows found their invoice.
 */
export async function rematchJaLines(): Promise<number> {
	const lines = await db.adviceLine.findMany({
		where: { result: "UNMATCHED", ...JA_LINE },
		include: {
			advice: {
				select: {
					id: true,
					adviceDate: true,
					reference: true,
					appliedAt: true,
				},
			},
		},
	})
	if (lines.length === 0) return 0
	// One read for every row's invoice, instead of one per row.
	const invoices = await db.ewitInvoice.findMany({
		where: {
			number: { in: [...new Set(lines.map((l) => jaNumber(l.invoiceRef)))] },
		},
		select: {
			id: true,
			number: true,
			voidedAt: true,
			heldAt: true,
			claroTotal: true,
			claroPaidAt: true,
		},
	})
	const byNumber = new Map(invoices.map((i) => [i.number, i]))
	let found = 0
	for (const l of lines) {
		const m = jaMatch(
			byNumber.get(jaNumber(l.invoiceRef)) ?? null,
			Number(l.net),
		)
		if (m.result === "UNMATCHED") continue
		const done = await db.adviceLine.updateMany({
			where: { id: l.id, result: "UNMATCHED" },
			data: { result: m.result, ewitInvoiceId: m.ewitInvoiceId },
		})
		if (done.count === 0) continue
		found += 1
		if (m.result !== "MATCHED" && m.result !== "SHORT") continue
		const jaDeskDone =
			l.advice.appliedAt !== null ||
			(await db.adviceLine.count({
				where: { adviceId: l.adviceId, appliedAt: { not: null }, ...JA_LINE },
			})) > 0
		if (jaDeskDone)
			// Carmen's installer invoice carries no audit entry, so no user is needed.
			await applyLine({ ...l, ewitInvoiceId: m.ewitInvoiceId }, l.advice, "")
	}
	return found
}

/**
 * Apply one desk's share of the advice: matched and short rows of `kind` are
 * paid ("m19" is Lissette's, "ja" is Carmen's); the other desk's rows and the
 * unmatched rows stay. The advice itself is stamped applied only once no
 * payable row of either kind is left, so it stays pending for the other desk.
 * Each row is claimed on its own, so a double submit pays nothing twice.
 */
export async function applyAdvice(
	adviceId: string,
	userId: string,
	kind: AdviceKind = "m19",
) {
	const advice = await db.paymentAdvice.findUnique({
		where: { id: adviceId },
		include: { lines: true },
	})
	if (!advice) throw new AdviceError("not_found")
	if (advice.appliedAt) throw new AdviceError("already_applied")
	if (r2(Number(advice.rowsTotal)) !== r2(Number(advice.total)))
		throw new AdviceError("total_mismatch")
	for (const line of advice.lines) {
		if (
			isOtherJafRef(line.invoiceRef) === (kind === "ja") &&
			!line.appliedAt &&
			(line.result === "MATCHED" || line.result === "SHORT")
		)
			await applyLine(line, advice, userId)
	}
	const left = await db.adviceLine.count({
		where: {
			adviceId,
			appliedAt: null,
			result: { in: ["MATCHED", "SHORT"] },
		},
	})
	if (left === 0)
		await db.paymentAdvice.updateMany({
			where: { id: adviceId, appliedAt: null },
			data: { appliedAt: new Date(), appliedById: userId },
		})
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
	// The M19 desk is done with this advice when it is applied, or when its own
	// rows were paid while the JA rows still wait for Carmen.
	const deskDone =
		line.advice.appliedAt !== null ||
		(await db.adviceLine.count({
			where: {
				adviceId: line.adviceId,
				appliedAt: { not: null },
				NOT: JA_LINE,
			},
		})) > 0
	if (deskDone && (m.result === "MATCHED" || m.result === "SHORT"))
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

const PAYABLE = ["MATCHED" as const, "SHORT" as const]

/**
 * Of these rows' JA numbers, the ones whose installer invoice exists and is live
 * but has no PO yet (no claroTotal): adding the PO is all those rows wait for.
 */
async function jaNumbersWithoutPo(refs: string[]): Promise<Set<string>> {
	const numbers = [...new Set(refs.filter(isOtherJafRef).map(jaNumber))]
	if (numbers.length === 0) return new Set()
	const rows = await db.ewitInvoice.findMany({
		where: {
			number: { in: numbers },
			claroTotal: null,
			voidedAt: null,
			heldAt: null,
		},
		select: { number: true },
	})
	return new Set(rows.map((r) => r.number))
}

/** A desk is done with an advice once it paid some rows and has no payable row left. */
const deskDone = (kind: AdviceKind) => ({
	AND: [
		{ lines: { some: { ...lineKind(kind), appliedAt: { not: null } } } },
		{
			lines: {
				none: { ...lineKind(kind), result: { in: PAYABLE }, appliedAt: null },
			},
		},
	],
})

/** Counts for the tabs, for one desk's rows. */
export async function adviceCounts(kind: AdviceKind = "m19") {
	const has = { lines: { some: lineKind(kind) } }
	const [pending, applied, unmatched] = await Promise.all([
		db.paymentAdvice.count({
			where: { ...has, appliedAt: null, NOT: deskDone(kind) },
		}),
		db.paymentAdvice.count({
			where: { ...has, OR: [{ appliedAt: { not: null } }, deskDone(kind)] },
		}),
		db.adviceLine.count({ where: { result: "UNMATCHED", ...lineKind(kind) } }),
	])
	return { pending, applied, unmatched }
}

export async function listAdvices(applied: boolean, kind: AdviceKind = "m19") {
	const rows = await db.paymentAdvice.findMany({
		where: {
			lines: { some: lineKind(kind) },
			...(applied
				? { OR: [{ appliedAt: { not: null } }, deskDone(kind)] }
				: { appliedAt: null, NOT: deskDone(kind) }),
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
	const noPo = await jaNumbersWithoutPo(
		rows.flatMap((a) =>
			a.lines.filter((l) => l.result === "UNMATCHED").map((l) => l.invoiceRef),
		),
	)
	// The other desk's rows on the same advice, so a card shows both shares.
	const other = rows.length
		? await db.adviceLine.groupBy({
				by: ["adviceId"],
				where: {
					adviceId: { in: rows.map((a) => a.id) },
					...lineKind(kind === "ja" ? "m19" : "ja"),
				},
				_count: { _all: true },
				_sum: { net: true },
			})
		: []
	const otherBy = new Map(other.map((o) => [o.adviceId, o]))
	return rows.map((a) => ({
		id: a.id,
		adviceDate: a.adviceDate.toISOString(),
		deskTotal: a.lines.reduce((sum, l) => sum + cents(Number(l.net)), 0) / 100,
		otherCount: otherBy.get(a.id)?._count._all ?? 0,
		otherTotal: Number(otherBy.get(a.id)?._sum.net ?? 0),
		bank: a.bank,
		reference: a.reference,
		total: Number(a.total),
		rowsTotal: Number(a.rowsTotal),
		totalOk: r2(Number(a.total)) === r2(Number(a.rowsTotal)),
		// For this desk: the advice is applied, or this desk's rows are all paid.
		applied:
			a.appliedAt !== null ||
			(a.lines.some((l) => l.appliedAt !== null) &&
				!a.lines.some(
					(l) =>
						l.appliedAt === null &&
						(l.result === "MATCHED" || l.result === "SHORT"),
				)),
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
				/** An unmatched JA row whose invoice exists but has no PO yet. */
				jaNoPo: l.result === "UNMATCHED" && noPo.has(jaNumber(l.invoiceRef)),
				invoiceId: l.invoiceId,
				/** Short paid and not yet accepted. */
				needsAccept: e
					? l.result === "SHORT" &&
						e.claroPaidAt !== null &&
						e.shortAcceptedAt === null &&
						r2(num(e.claroPaidNet) ?? 0) < r2(num(e.claroTotal) ?? 0)
					: l.result === "SHORT" &&
						l.appliedAt !== null &&
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
	const noPo = await jaNumbersWithoutPo(rows.map((l) => l.invoiceRef))
	return rows.map((l) => ({
		id: l.id,
		invoiceRef: l.invoiceRef,
		voucher: l.voucher,
		net: Number(l.net),
		adviceDate: l.advice.adviceDate.toISOString(),
		reference: l.advice.reference,
		jaNoPo: noPo.has(jaNumber(l.invoiceRef)),
	}))
}

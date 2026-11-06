import {
	defaultWorkMonth,
	dueDateOf,
	invoiceNumber,
	isWorkMonth,
	NEW_SERIES,
	nextSeq,
	OLD_SERIES,
	parseInvoiceRef,
} from "~/lib/claro-invoice"
import { db } from "~/lib/db.server"
import { zipPackage } from "~/lib/package-zip.server"
import { matchWaitingLines } from "~/lib/payment-advice.server"
import { generateFacturaDePagoPdf } from "~/lib/pdf/factura-de-pago.server"
import {
	assertReviewed,
	confirmPo,
	PoError,
	type PoOverride,
} from "~/lib/po-inbox.server"
import { getInvoiceSignature } from "~/lib/system-settings.server"
import { saveBuffer } from "~/lib/uploads.server"
import { Prisma } from "../../generated/prisma/client"

type ClaroInvoiceErrorCode =
	| "po_not_confirmable"
	| "already_made"
	| "work_month_required"
	| "total_mismatch"
	| "not_found"
	| "already_loaded"
	| "not_loaded_yet"
	| "no_signature"
	| "not_old_number"
	| "number_taken"
	| "po_not_available"
	| "bad_total"

export class ClaroInvoiceError extends Error {
	constructor(readonly code: ClaroInvoiceErrorCode) {
		super(code)
		this.name = "ClaroInvoiceError"
	}
}

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d))
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Confirmed POs with no invoice yet: the To make tab. */
export async function listToMake() {
	const pos = await db.claroPo.findMany({
		where: { status: "CONFIRMED", invoice: null },
		orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
		include: { doc: { select: { avisoNumber: true, fieldStartedAt: true } } },
	})
	return pos.map((p) => ({
		poId: p.id,
		poNumber: p.poNumber ?? "",
		avisoNumber: p.doc?.avisoNumber ?? null,
		total: num(p.total),
		suggestedMonth: defaultWorkMonth(p.doc?.fieldStartedAt ?? null, p.poDate),
	}))
}

/** Whose signature the invoice carries, for the audit trail. */
const SIGNER = "Lissette Cintron"

/** What an invoice for this PO would carry, or why it cannot be made. */
async function makeable(
	po: {
		poDate: Date | null
		subtotal: Prisma.Decimal | null
		ivu4: Prisma.Decimal | null
		ivu115: Prisma.Decimal | null
		total: Prisma.Decimal | null
		doc: { fieldStartedAt: Date | null } | null
	},
	asked: string | null,
) {
	const workMonth =
		asked && isWorkMonth(asked)
			? asked
			: defaultWorkMonth(po.doc?.fieldStartedAt ?? null, po.poDate)
	if (!workMonth) throw new ClaroInvoiceError("work_month_required")
	const subtotal = num(po.subtotal) ?? 0
	const ivu4 = num(po.ivu4) ?? 0
	const ivu115 = num(po.ivu115) ?? 0
	const total = num(po.total) ?? 0
	// The invoice must equal the PO to the cent.
	if (round2(subtotal + ivu4 + ivu115) !== round2(total))
		throw new ClaroInvoiceError("total_mismatch")
	const signature = await getInvoiceSignature()
	if (!signature) throw new ClaroInvoiceError("no_signature")
	return { workMonth, subtotal, ivu4, ivu115, total, signature }
}

/**
 * Make the invoice for one confirmed PO, signed. This is the one place the stored
 * signature is stamped, so it cannot appear on anything but an invoice made from a
 * confirmed PO, and every stamp is in the audit trail. The number is max + 1 of the
 * series inside a serializable transaction, and series + `seq` is unique, so
 * numbers never repeat; a failed make rolls back the number, so they never skip
 * either. The PDF is written after the row exists and its path saved with it.
 */
export async function makeInvoice(args: {
	poId: string
	workMonth: string | null
	madeById: string
}): Promise<{ id: string; seq: number }> {
	const po = await db.claroPo.findUnique({
		where: { id: args.poId },
		include: { doc: { select: { fieldStartedAt: true } }, invoice: true },
	})
	if (!po) throw new ClaroInvoiceError("not_found")
	if (po.status !== "CONFIRMED" || !po.docId || !po.poNumber)
		throw new ClaroInvoiceError("po_not_confirmable")
	if (po.invoice) throw new ClaroInvoiceError("already_made")
	const { workMonth, subtotal, ivu4, ivu115, total, signature } =
		await makeable(po, args.workMonth)

	for (let attempt = 0; ; attempt++) {
		try {
			const made = await db.$transaction(
				async (tx) => {
					const last = await tx.claroInvoice.aggregate({
						where: { series: NEW_SERIES },
						_max: { seq: true },
					})
					const seq = nextSeq(last._max.seq)
					const number = invoiceNumber({ series: NEW_SERIES, seq })
					const madeAt = new Date()
					const pdf = await generateFacturaDePagoPdf({
						number,
						madeAt,
						workMonth,
						poNumber: po.poNumber ?? "",
						subtotal,
						ivu4,
						ivu115,
						total,
						signature,
					})
					const filePath = await saveBuffer(
						"claro-invoices",
						`${number}.pdf`,
						pdf,
					)
					const row = await tx.claroInvoice.create({
						data: {
							series: NEW_SERIES,
							seq,
							claroPoId: po.id,
							docId: po.docId as string,
							workMonth,
							subtotal,
							ivu4,
							ivu115,
							total,
							filePath,
							madeAt,
							madeById: args.madeById,
						},
					})
					await tx.auditTrail.create({
						data: {
							docId: po.docId as string,
							userId: args.madeById,
							action: "CLARO_INVOICE_MADE",
							diffJson: {
								source: "STAMPED",
								invoice: number,
								poNumber: po.poNumber,
								total,
								signedBy: SIGNER,
							},
						},
					})
					return { id: row.id, seq }
				},
				{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
			)
			return made
		} catch (e) {
			const code = (e as { code?: string }).code
			// Another make took this number first: try the next one.
			if ((code === "P2002" || code === "P2034") && attempt < 5) {
				const again = await db.claroInvoice.findUnique({
					where: { claroPoId: po.id },
				})
				if (again) throw new ClaroInvoiceError("already_made")
				continue
			}
			throw e
		}
	}
}

/**
 * The Generate step: confirm the PO as reviewed and make its invoice. Missing
 * pages and duplicates refuse outright; any other red check needs a reason,
 * stored on the PO and audited per check (`confirmPo`). A PO that already has
 * an invoice is refused before anything is touched, so no number is taken. A
 * PO confirmed earlier (old screens, or a make that failed) is just made.
 */
export async function generateFromPo(args: {
	poId: string
	userId: string
	workMonth: string | null
	overrides: PoOverride[]
}): Promise<{ invoiceId: string; seq: number }> {
	const po = await db.claroPo.findUnique({
		where: { id: args.poId },
		include: {
			doc: { select: { fieldStartedAt: true } },
			invoice: { select: { id: true } },
		},
	})
	if (!po) throw new ClaroInvoiceError("not_found")
	if (po.invoice) throw new ClaroInvoiceError("already_made")
	if (po.status !== "CONFIRMED") {
		// The review first, so a stopped PO says why; then what the make would
		// refuse, so a PO is never left confirmed (and closed to edits) without
		// an invoice it can get.
		await assertReviewed(args.poId, args.overrides, args.userId)
		const fresh = await db.claroPo.findUniqueOrThrow({
			where: { id: args.poId },
			include: { doc: { select: { fieldStartedAt: true } } },
		})
		await makeable(fresh, args.workMonth)
		try {
			await confirmPo(args.poId, args.userId, { overrides: args.overrides })
		} catch (e) {
			// Confirmed by a second click in between: carry on to the make.
			if (!(e instanceof PoError && e.code === "already_confirmed")) throw e
		}
	}
	const made = await makeInvoice({
		poId: args.poId,
		workMonth: args.workMonth,
		madeById: args.userId,
	})
	return { invoiceId: made.id, seq: made.seq }
}

/**
 * An old M19 the system doesn't have, added by hand because a PO or a payment
 * refers to it. It keeps the amount typed, which may differ from the PO's, and has
 * no PDF. Rows already read that name it find it now.
 */
export async function addOldInvoice(args: {
	number: string
	total: number
	poNumber: string | null
	loadedAt: Date | null
	userId: string
}): Promise<{ id: string }> {
	const ref = parseInvoiceRef(args.number)
	if (ref?.series !== OLD_SERIES) throw new ClaroInvoiceError("not_old_number")
	if (!Number.isFinite(args.total) || args.total <= 0)
		throw new ClaroInvoiceError("bad_total")
	const taken = await db.claroInvoice.findUnique({
		where: { series_seq: { series: OLD_SERIES, seq: ref.seq } },
		select: { id: true },
	})
	if (taken) throw new ClaroInvoiceError("number_taken")
	const po = args.poNumber
		? await db.claroPo.findFirst({
				where: {
					poNumber: args.poNumber,
					status: "CONFIRMED",
					invoice: null,
				},
			})
		: null
	if (args.poNumber && !po) throw new ClaroInvoiceError("po_not_available")
	const total = round2(args.total)
	// The PO's split only when it is the same amount; a total alone otherwise.
	const samePo = po && round2(num(po.total) ?? 0) === total
	const number = invoiceNumber({ series: OLD_SERIES, seq: ref.seq })
	const row = await db.claroInvoice.create({
		data: {
			series: OLD_SERIES,
			seq: ref.seq,
			claroPoId: po?.id ?? null,
			docId: po?.docId ?? null,
			workMonth: "",
			subtotal: samePo ? (num(po.subtotal) ?? total) : total,
			ivu4: samePo ? (num(po.ivu4) ?? 0) : 0,
			ivu115: samePo ? (num(po.ivu115) ?? 0) : 0,
			total,
			madeById: args.userId,
			loadedAt: args.loadedAt,
			loadedById: args.loadedAt ? args.userId : null,
			dueDate: args.loadedAt
				? dueDateOf(args.loadedAt, po?.termsDays ?? 60)
				: null,
		},
	})
	if (row.docId)
		await db.auditTrail.create({
			data: {
				docId: row.docId,
				userId: args.userId,
				action: "CLARO_INVOICE_ADDED_OLD",
				diffJson: {
					source: "ENTERED",
					invoice: number,
					poNumber: args.poNumber,
					total,
				},
			},
		})
	await matchWaitingLines({ series: OLD_SERIES, seq: ref.seq }, args.userId)
	return { id: row.id }
}

export async function makeInvoices(
	items: { poId: string; workMonth: string | null }[],
	madeById: string,
): Promise<{ made: number; failed: number }> {
	let made = 0
	let failed = 0
	for (const it of items) {
		try {
			await makeInvoice({ ...it, madeById })
			made++
		} catch (e) {
			if (!(e instanceof ClaroInvoiceError)) throw e
			failed++
		}
	}
	return { made, failed }
}

/** Lissette ticks the ones she loaded in Ariba. Sets loaded date and due date = loaded + PO terms. */
export async function markLoaded(
	ids: string[],
	userId: string,
	loadedAt = new Date(),
): Promise<{ marked: number }> {
	let marked = 0
	for (const id of ids) {
		const inv = await db.claroInvoice.findUnique({
			where: { id },
			include: { claroPo: { select: { termsDays: true } } },
		})
		if (!inv || inv.loadedAt) continue
		const terms = inv.claroPo?.termsDays ?? 60
		const due = dueDateOf(loadedAt, terms)
		const r = await db.claroInvoice.updateMany({
			where: { id, loadedAt: null },
			data: { loadedAt, loadedById: userId, dueDate: due },
		})
		if (r.count === 0) continue
		if (inv.docId)
			await db.auditTrail.create({
				data: {
					docId: inv.docId,
					userId,
					action: "CLARO_INVOICE_LOADED",
					diffJson: {
						source: "STAMPED",
						invoice: invoiceNumber(inv),
						loadedAt: loadedAt.toISOString(),
						dueDate: due.toISOString().slice(0, 10),
						termsDays: terms,
					},
				},
			})
		marked++
	}
	return { marked }
}

type InvoiceTab = "to_make" | "not_loaded" | "in_ariba"
export const INVOICE_TABS: InvoiceTab[] = ["to_make", "not_loaded", "in_ariba"]

export async function claroInvoiceCounts() {
	const [toMake, notLoaded, inAriba] = await Promise.all([
		db.claroPo.count({ where: { status: "CONFIRMED", invoice: null } }),
		db.claroInvoice.count({ where: { loadedAt: null } }),
		db.claroInvoice.count({ where: { loadedAt: { not: null } } }),
	])
	return { toMake, notLoaded, inAriba }
}

export async function listInvoices(tab: "not_loaded" | "in_ariba", take = 300) {
	const rows = await db.claroInvoice.findMany({
		where: { loadedAt: tab === "in_ariba" ? { not: null } : null },
		orderBy: [{ series: "asc" }, { seq: "asc" }],
		take,
		include: {
			claroPo: { select: { poNumber: true } },
			doc: { select: { avisoNumber: true } },
		},
	})
	return rows.map((r) => ({
		id: r.id,
		number: invoiceNumber(r),
		poNumber: r.claroPo?.poNumber ?? "",
		avisoNumber: r.doc?.avisoNumber ?? null,
		hasFile: r.filePath !== null,
		total: Number(r.total),
		madeAt: r.madeAt.toISOString(),
		loadedAt: r.loadedAt?.toISOString() ?? null,
		dueDate: r.dueDate?.toISOString() ?? null,
	}))
}

/** The selected invoices' PDFs in one zip. */
export async function zipInvoices(ids: string[]): Promise<Buffer> {
	const rows = await db.claroInvoice.findMany({
		where: { id: { in: ids } },
		orderBy: [{ series: "asc" }, { seq: "asc" }],
	})
	return zipPackage(
		rows.flatMap((r) =>
			r.filePath ? [{ name: `${invoiceNumber(r)}.pdf`, path: r.filePath }] : [],
		),
	)
}

export async function invoiceFile(id: string) {
	const r = await db.claroInvoice.findUnique({
		where: { id },
		select: { filePath: true, series: true, seq: true },
	})
	return r?.filePath
		? { path: r.filePath, name: `${invoiceNumber(r)}.pdf` }
		: null
}

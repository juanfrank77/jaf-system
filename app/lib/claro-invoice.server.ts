import {
	defaultWorkMonth,
	dueDateOf,
	invoiceNumber,
	isWorkMonth,
} from "~/lib/claro-invoice"
import { db } from "~/lib/db.server"
import { zipPackage } from "~/lib/package-zip.server"
import { generateFacturaDePagoPdf } from "~/lib/pdf/factura-de-pago.server"
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

/** The first number of the series, used only until the first invoice exists. */
async function firstNumber(): Promise<number> {
	const s = await db.systemSetting.findUnique({
		where: { key: "claro_invoice_first_number" },
	})
	const n = s ? Number(s.value) : NaN
	return Number.isInteger(n) && n > 0 ? n : 1
}

/**
 * Make the invoice for one confirmed PO. The number is max + 1 inside a
 * serializable transaction, and `seq` is unique, so numbers never repeat; a
 * failed make rolls back the number, so they never skip either. The PDF is
 * written after the row exists and its path saved with it.
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
	const workMonth =
		args.workMonth && isWorkMonth(args.workMonth)
			? args.workMonth
			: defaultWorkMonth(po.doc?.fieldStartedAt ?? null, po.poDate)
	if (!workMonth) throw new ClaroInvoiceError("work_month_required")
	const subtotal = num(po.subtotal) ?? 0
	const ivu4 = num(po.ivu4) ?? 0
	const ivu115 = num(po.ivu115) ?? 0
	const total = num(po.total) ?? 0
	// The invoice must equal the PO to the cent.
	if (round2(subtotal + ivu4 + ivu115) !== round2(total))
		throw new ClaroInvoiceError("total_mismatch")

	const first = await firstNumber()
	for (let attempt = 0; ; attempt++) {
		try {
			const made = await db.$transaction(
				async (tx) => {
					const last = await tx.claroInvoice.aggregate({ _max: { seq: true } })
					const seq = last._max.seq === null ? first : last._max.seq + 1
					const madeAt = new Date()
					const pdf = await generateFacturaDePagoPdf({
						seq,
						madeAt,
						workMonth,
						poNumber: po.poNumber ?? "",
						subtotal,
						ivu4,
						ivu115,
						total,
					})
					const filePath = await saveBuffer(
						"claro-invoices",
						`${invoiceNumber(seq)}.pdf`,
						pdf,
					)
					const row = await tx.claroInvoice.create({
						data: {
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
							docId: row.docId,
							userId: args.madeById,
							action: "CLARO_INVOICE_MADE",
							diffJson: {
								source: "STAMPED",
								invoice: invoiceNumber(seq),
								poNumber: po.poNumber,
								total,
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
		const terms = inv.claroPo.termsDays ?? 60
		const due = dueDateOf(loadedAt, terms)
		const r = await db.claroInvoice.updateMany({
			where: { id, loadedAt: null },
			data: { loadedAt, loadedById: userId, dueDate: due },
		})
		if (r.count === 0) continue
		await db.auditTrail.create({
			data: {
				docId: inv.docId,
				userId,
				action: "CLARO_INVOICE_LOADED",
				diffJson: {
					source: "STAMPED",
					invoice: invoiceNumber(inv.seq),
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
		orderBy: [{ seq: "asc" }],
		take,
		include: {
			claroPo: { select: { poNumber: true } },
			doc: { select: { avisoNumber: true } },
		},
	})
	return rows.map((r) => ({
		id: r.id,
		number: invoiceNumber(r.seq),
		poNumber: r.claroPo.poNumber ?? "",
		avisoNumber: r.doc.avisoNumber,
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
		orderBy: { seq: "asc" },
	})
	return zipPackage(
		rows.map((r) => ({
			name: `${invoiceNumber(r.seq)}.pdf`,
			path: r.filePath,
		})),
	)
}

export async function invoiceFile(id: string) {
	const r = await db.claroInvoice.findUnique({
		where: { id },
		select: { filePath: true, seq: true },
	})
	return r ? { path: r.filePath, name: `${invoiceNumber(r.seq)}.pdf` } : null
}

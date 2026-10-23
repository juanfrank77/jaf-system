import { db } from "~/lib/db.server"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import type { PoDetailView, PoRowView, PoTab } from "~/lib/po-inbox-view"
import { PO_TAB_STATUS } from "~/lib/po-inbox-view"
import type { PoCheck, PoLine } from "~/lib/po-reading"

const num = (d: { toString(): string } | null | undefined) =>
	d === null || d === undefined ? null : Number(d.toString())

export async function listPoRows(tab: PoTab, take = 200): Promise<PoRowView[]> {
	const rows = await db.claroPo.findMany({
		where: { status: PO_TAB_STATUS[tab] },
		orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
		take,
		include: { doc: { select: { avisoNumber: true } } },
	})
	return rows.map((r) => ({
		id: r.id,
		fileName: r.fileName,
		poNumber: r.poNumber,
		poDate: r.poDate?.toISOString().slice(0, 10) ?? null,
		avisoNumber: r.doc?.avisoNumber ?? null,
		total: num(r.total),
		checks: (r.checks as PoCheck[] | null) ?? [],
		readError: r.readError,
	}))
}

export async function loadPoDetail(id: string): Promise<PoDetailView | null> {
	const r = await db.claroPo.findUnique({
		where: { id },
		include: {
			doc: { select: { avisoNumber: true, jafInvoiceLines: true } },
		},
	})
	if (!r) return null
	let billed: number | null = null
	let alreadyPod = 0
	if (r.doc) {
		const lines = Array.isArray(r.doc.jafInvoiceLines)
			? (r.doc.jafInvoiceLines as { qty: number; unitPrice: number }[])
			: []
		billed = computeInvoiceTotals(lines).subtotal
		const others = await db.claroPo.findMany({
			where: { docId: r.docId, status: "CONFIRMED", id: { not: id } },
			select: { subtotal: true },
		})
		alreadyPod = others.reduce((s, o) => s + (num(o.subtotal) ?? 0), 0)
	}
	return {
		id: r.id,
		fileName: r.fileName,
		status: r.status as PoDetailView["status"],
		poNumber: r.poNumber,
		poDate: r.poDate?.toISOString().slice(0, 10) ?? null,
		avisoNumber: r.doc?.avisoNumber ?? null,
		total: num(r.total),
		checks: (r.checks as PoCheck[] | null) ?? [],
		readError: r.readError,
		termsDays: r.termsDays,
		subtotal: num(r.subtotal),
		ivu4: num(r.ivu4),
		ivu115: num(r.ivu115),
		lines: Array.isArray(r.lines) ? (r.lines as unknown as PoLine[]) : [],
		statedPages: r.statedPages,
		filePages: r.filePages,
		billed,
		alreadyPod,
		confirmedAt: r.confirmedAt?.toISOString() ?? null,
	}
}

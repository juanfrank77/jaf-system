import { computeInvoiceTotals } from "~/lib/invoice-totals"

/**
 * One Aviso, read from what Steps 1-7 already stored. Plain data in, plain data
 * out, so the record page, the Ledger, the reports and the Excel all work from
 * the same numbers (nothing here is typed by hand).
 */

/** Where a date came from (Rule 4). */
export type DateSource = "DOCUMENT" | "STAMPED" | "ENTERED"
export type Dated = { at: string | null; source: DateSource | null }

export type AvisoRaw = {
	id: string
	avisoNumber: string | null
	controlNumber: string
	address: string
	supervisor: string
	brigades: string[]
	zone: string | null
	jobCompletedAt: Date | null
	lines: { qty: number; unitPrice: number }[]
	releasedAt: Date | null
	acceptedAt: Date | null
	soldAt: Date | null
	batchNumber: number | null
	payrollRequestAt: Date | null
	brigadePaidAt: Date | null
	armBClosedAt: Date | null
	pos: {
		poNumber: string
		poId: string
		poDate: Date | null
		poSubtotal: number
		poTotal: number
		poConfirmedAt: Date | null
		termsDays: number | null
		invoice: {
			id: string
			seq: number
			total: number
			madeAt: Date
			loadedAt: Date | null
			dueDate: Date | null
			paidAt: Date | null
			paidNet: number | null
			voucherId: string | null
			shortAcceptedAt: Date | null
		} | null
	}[]
}

export type PoRow = {
	poId: string
	poNumber: string
	poAmount: number
	poDate: Dated
	invoiceId: string | null
	invoiceNumber: string | null
	invoiceTotal: number | null
	made: Dated
	loaded: Dated
	due: Dated
	paid: Dated
	netPaid: number | null
	voucher: string | null
	/** Loaded in Ariba -> paid, or -> now while unpaid. */
	days: number | null
	termsDays: number
	pastDue: boolean
	shortBy: number
	closed: boolean
}

export type AvisoSummary = {
	id: string
	avisoNumber: string | null
	controlNumber: string
	address: string
	supervisor: string
	brigades: string[]
	zone: string | null
	jobCompleted: Dated
	invoice: { subtotal: number; ivu4: number; ivu115: number; total: number }
	armA: {
		released: Dated
		accepted: Dated
		sold: Dated
		batchNumber: number | null
		payrollRequest: Dated
		brigadePaid: Dated
		days: number | null
		closed: boolean
	}
	pos: PoRow[]
	money: {
		billed: number
		poed: number
		inAriba: number
		paid: number
		outstanding: number
		stillToPo: number
	}
	armB: "NOT_STARTED" | "OPEN" | "CLOSED"
	done: boolean
	/** Oldest open PO, in days since its PO date. */
	oldestOpenPoDays: number | null
}

const DAY = 86_400_000
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const dated = (d: Date | null | undefined, source: DateSource): Dated => ({
	at: iso(d),
	source: d ? source : null,
})

/** Whole days from `a` to `b` (negative never reported). */
export function daysBetween(a: Date, b: Date): number {
	return Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY))
}

export function summarizeAviso(raw: AvisoRaw, now: Date): AvisoSummary {
	const t = computeInvoiceTotals(raw.lines)
	const pos: PoRow[] = raw.pos.map((p) => {
		const inv = p.invoice
		const terms = p.termsDays ?? 60
		const paid = inv?.paidAt ?? null
		const days = inv?.loadedAt ? daysBetween(inv.loadedAt, paid ?? now) : null
		const net = inv?.paidNet ?? null
		const shortBy =
			inv && paid && net !== null && net < inv.total ? r2(inv.total - net) : 0
		const closed = !!(
			inv?.paidAt &&
			(inv.shortAcceptedAt || (net !== null && r2(net) >= r2(inv.total)))
		)
		return {
			poId: p.poId,
			poNumber: p.poNumber,
			poAmount: p.poTotal,
			poDate: dated(p.poDate, "DOCUMENT"),
			invoiceId: inv?.id ?? null,
			invoiceNumber: inv ? `M19-${inv.seq}` : null,
			invoiceTotal: inv?.total ?? null,
			made: dated(inv?.madeAt, "STAMPED"),
			loaded: dated(inv?.loadedAt, "STAMPED"),
			due: dated(inv?.dueDate, "STAMPED"),
			paid: dated(paid, "DOCUMENT"),
			netPaid: net,
			voucher: inv?.voucherId ?? null,
			days,
			termsDays: terms,
			pastDue: !!(inv?.loadedAt && days !== null && days > terms && !closed),
			shortBy,
			closed,
		}
	})
	const billed = t.total
	const poed = r2(raw.pos.reduce((s, p) => s + p.poTotal, 0))
	const inAriba = r2(
		pos
			.filter((p) => p.loaded.at)
			.reduce((s, p) => s + (p.invoiceTotal ?? 0), 0),
	)
	const paid = r2(pos.reduce((s, p) => s + (p.netPaid ?? 0), 0))
	// A short pay Lissette accepted is settled: it no longer counts as owed.
	const acceptedShort = r2(
		raw.pos.reduce(
			(s, p, i) => s + (p.invoice?.shortAcceptedAt ? pos[i].shortBy : 0),
			0,
		),
	)
	const armBClosed = raw.armBClosedAt !== null
	const armAClosed = raw.brigadePaidAt !== null
	const openPoDays = raw.pos
		.map((p, i) =>
			pos[i].closed || !p.poDate ? null : daysBetween(p.poDate, now),
		)
		.filter((d): d is number => d !== null)
	return {
		id: raw.id,
		avisoNumber: raw.avisoNumber,
		controlNumber: raw.controlNumber,
		address: raw.address,
		supervisor: raw.supervisor,
		brigades: raw.brigades,
		zone: raw.zone,
		jobCompleted: dated(raw.jobCompletedAt, "STAMPED"),
		invoice: {
			subtotal: t.subtotal,
			ivu4: t.ivu4,
			ivu115: t.ivu115,
			total: t.total,
		},
		armA: {
			released: dated(raw.releasedAt, "STAMPED"),
			accepted: dated(raw.acceptedAt, "STAMPED"),
			sold: dated(raw.soldAt, "STAMPED"),
			batchNumber: raw.batchNumber,
			payrollRequest: dated(raw.payrollRequestAt, "STAMPED"),
			brigadePaid: dated(raw.brigadePaidAt, "STAMPED"),
			days:
				raw.soldAt && raw.brigadePaidAt
					? daysBetween(raw.soldAt, raw.brigadePaidAt)
					: null,
			closed: armAClosed,
		},
		pos,
		money: {
			billed,
			poed,
			inAriba,
			paid,
			outstanding: Math.max(0, r2(billed - paid - acceptedShort)),
			stillToPo: Math.max(0, r2(billed - poed)),
		},
		armB: armBClosed ? "CLOSED" : raw.pos.length > 0 ? "OPEN" : "NOT_STARTED",
		done: armAClosed && armBClosed,
		oldestOpenPoDays: openPoDays.length > 0 ? Math.max(...openPoDays) : null,
	}
}

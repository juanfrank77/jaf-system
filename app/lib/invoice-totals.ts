import { round2 } from "./service-lines"

/** Puerto Rico IVU on JAF's work: the rate every JAF line uses unless it says otherwise. */
export const IVU_RATE_STANDARD = 0.115
/** The reduced rate some Claro PO lines carry. */
export const IVU_RATE_REDUCED = 0.04

export type TotalsInput = {
	qty: number
	unitPrice: number
	/** Falls back to the rate passed to `computeInvoiceTotals`. */
	ivuRate?: number
}

export type TotalsLine = {
	lineAmount: number
	ivuRate: number
	lineIvu: number
}

export type InvoiceTotals = {
	lines: TotalsLine[]
	/** Pre-IVU. */
	subtotal: number
	ivu4: number
	ivu115: number
	/** Lines at any other rate, so a setting change cannot lose tax silently. */
	ivuOther: number
	ivu: number
	total: number
}

/**
 * The one place an invoice amount is worked out. Every screen, PDF and Excel
 * reads these numbers and never recalculates its own: the amount and the IVU of
 * each line are rounded once, then the lines are added up.
 */
export function computeInvoiceTotals(
	items: TotalsInput[],
	defaultRate: number = IVU_RATE_STANDARD,
): InvoiceTotals {
	const lines = items.map((item): TotalsLine => {
		const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0
		const price = Number.isFinite(Number(item.unitPrice))
			? Number(item.unitPrice)
			: 0
		const ivuRate = item.ivuRate ?? defaultRate
		const lineAmount = round2(qty * price)
		return { lineAmount, ivuRate, lineIvu: round2(lineAmount * ivuRate) }
	})
	const sum = (
		pick: (l: TotalsLine) => number,
		only?: (l: TotalsLine) => boolean,
	) =>
		round2(lines.filter(only ?? (() => true)).reduce((s, l) => s + pick(l), 0))
	const at = (rate: number) => (l: TotalsLine) => l.ivuRate === rate
	const subtotal = sum((l) => l.lineAmount)
	const ivu4 = sum((l) => l.lineIvu, at(IVU_RATE_REDUCED))
	const ivu115 = sum((l) => l.lineIvu, at(IVU_RATE_STANDARD))
	const ivu = sum((l) => l.lineIvu)
	return {
		lines,
		subtotal,
		ivu4,
		ivu115,
		ivuOther: round2(ivu - ivu4 - ivu115),
		ivu,
		total: round2(subtotal + ivu),
	}
}

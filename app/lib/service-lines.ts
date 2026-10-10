import { toNumberPrice } from "./utils"

export type ServiceLine = {
	serviceCodeId: string
	claroCode: string
	accountCode: string | null
	name: string
	qty: number
}

export type InvoiceLine = ServiceLine & {
	unit: string | null
	unitPrice: number
	lineAmount: number
}

export type AvisoLine = {
	serviceCodeId: string
	claroCode: string
	qty: number
	unitPrice: number
	lineAmount: number
}

export type PreCertLine = {
	serviceCodeId: string
	claroCode: string
	accountCode: string | null
	description: string
	installedQty: number
	certifiedQty: number
	editReason?: string
	unit: string | null
	unitPrice: number
	lineAmount: number
}

type CatalogEntry = {
	id: string
	claroCode: string
	name: string
	accountCode: string | null
	unit: string | null
	unitPrice: unknown
	priceListRevision?: string | null
}

export function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100
}

export function parseServiceLines(
	raw: string | null | undefined,
): ServiceLine[] {
	if (!raw) return []
	const parsed = JSON.parse(raw)
	if (!Array.isArray(parsed)) return []
	return parsed
		.filter(
			(l) =>
				l &&
				typeof l.serviceCodeId === "string" &&
				l.serviceCodeId !== "" &&
				Number(l.qty) > 0,
		)
		.map((l) => ({
			serviceCodeId: String(l.serviceCodeId),
			claroCode: String(l.claroCode ?? ""),
			accountCode: l.accountCode ? String(l.accountCode) : null,
			name: String(l.name ?? ""),
			qty: Number(l.qty),
		}))
}

export function buildInvoiceLines(
	lines: ServiceLine[],
	codeMap: Record<string, CatalogEntry>,
): InvoiceLine[] {
	return lines.flatMap((line) => {
		const code = codeMap[line.serviceCodeId]
		if (!code) return []
		const unitPrice = toNumberPrice(code.unitPrice)
		return [
			{
				serviceCodeId: line.serviceCodeId,
				claroCode: code.claroCode,
				accountCode: code.accountCode,
				name: code.name,
				qty: line.qty,
				unit: code.unit,
				unitPrice,
				lineAmount: round2(line.qty * unitPrice),
			},
		]
	})
}

export function sumLines(lines: { lineAmount: number }[]): number {
	return round2(lines.reduce((s, l) => s + l.lineAmount, 0))
}

export function buildPreCertLines(
	installed: ServiceLine[],
	codeMap: Record<string, CatalogEntry>,
): PreCertLine[] {
	return buildInvoiceLines(installed, codeMap).map((l) => ({
		serviceCodeId: l.serviceCodeId,
		claroCode: l.claroCode,
		accountCode: l.accountCode,
		description: l.name,
		installedQty: l.qty,
		certifiedQty: l.qty,
		unit: l.unit,
		unitPrice: l.unitPrice,
		lineAmount: l.lineAmount,
	}))
}

export function parseAvisoLines(raw: string | null | undefined): AvisoLine[] {
	if (!raw) return []
	const parsed = JSON.parse(raw)
	if (!Array.isArray(parsed)) return []
	return parsed
		.filter(
			(l) => l && typeof l.serviceCodeId === "string" && Number(l.qty) > 0,
		)
		.map((l) => {
			const qty = Number(l.qty)
			const unitPrice = Number(l.unitPrice) || 0
			return {
				serviceCodeId: String(l.serviceCodeId),
				claroCode: String(l.claroCode ?? ""),
				qty,
				unitPrice,
				lineAmount: round2(qty * unitPrice),
			}
		})
}

/**
 * Catalog descriptions end with a glued price-list code ("…ASFALTOMO",
 * "…C5MC"). Splits it into its own value so screens can show it as a column.
 * Only the last word is touched, and only when something precedes the MO/MC.
 */
export function splitServiceSuffix(name: string): {
	base: string
	suffix: "MO" | "MC" | null
} {
	const m = name.match(/^(.*?\S)(MO|MC)$/)
	if (!m) return { base: name, suffix: null }
	return { base: m[1], suffix: m[2] as "MO" | "MC" }
}

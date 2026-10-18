import { type AvisoLine, type InvoiceLine, round2 } from "~/lib/service-lines"
import { toNumberPrice } from "~/lib/utils"

type PdfRow = { claroCode: string; qtyUsed: number }
type CatalogCode = { id: string; claroCode: string; unitPrice: unknown }

/**
 * Turns the rows read from an Aviso PDF into Aviso lines. The PDF has no
 * prices: a code that is on the JAF invoice keeps the invoice-time price, any
 * other code uses the current catalog price. Codes missing from the catalog are
 * a data gap, reported (unique, sorted) so the caller can refuse the save.
 */
export function buildAvisoLines(
	rows: PdfRow[],
	invoiceLines: InvoiceLine[],
	catalog: CatalogCode[],
): { lines: AvisoLine[] } | { missingCodes: string[] } {
	const byCode = new Map(catalog.map((c) => [c.claroCode, c]))
	const invoicePrice = new Map(
		invoiceLines.map((l) => [l.claroCode, l.unitPrice]),
	)
	const missing = new Set<string>()
	const qtyByCode = new Map<string, number>()
	for (const r of rows) {
		if (!byCode.has(r.claroCode)) missing.add(r.claroCode)
		qtyByCode.set(r.claroCode, (qtyByCode.get(r.claroCode) ?? 0) + r.qtyUsed)
	}
	if (missing.size > 0) return { missingCodes: [...missing].sort() }

	const lines: AvisoLine[] = []
	for (const [claroCode, qty] of qtyByCode) {
		if (qty <= 0) continue
		const code = byCode.get(claroCode) as CatalogCode
		const unitPrice =
			invoicePrice.get(claroCode) ?? toNumberPrice(code.unitPrice)
		lines.push({
			serviceCodeId: code.id,
			claroCode,
			qty,
			unitPrice,
			lineAmount: round2(qty * unitPrice),
		})
	}
	return { lines }
}

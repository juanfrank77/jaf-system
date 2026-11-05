const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** First letter of Brigade.area (C/M/N/O/S), the bank schedule's "area" column. */
export function areaLetter(area: string | null | undefined): string | null {
	const a = area?.trim()
	return a ? a[0].toUpperCase() : null
}

/** Always M17: it is what marks an invoice as going to PBCC. */
export const BANK_INVOICE_PREFIX = "M17"

export function bankInvoiceNumber(prefix: string, avisoNumber: string): string {
	return `${prefix}-${avisoNumber}`
}

/** "M17" → "17-xxx", the contract number printed on the invoice header. */
export function contractLabel(prefix: string): string {
	return `${prefix.replace(/^M/i, "")}-xxx`
}

/** Comma segments of an address with any trailing "PR 00xxx" removed. */
function addressSegments(address: string): string[] {
	const stripped = address
		.trim()
		.replace(/[,\s]+$/, "")
		.replace(/(?:,\s*|\s+)PR(?:\s+\d{5}(?:-\d{4})?)?$/i, "")
		.replace(/[,\s]+$/, "")
	return stripped.split(",").map((s) => s.trim())
}

/** Municipality for the invoice's "Localidad": last comma segment, minus state and zip. */
export function localityFromAddress(address: string): string {
	return addressSegments(address).pop() ?? ""
}

/**
 * The barrio / street line under the job description on the bank invoice: the
 * first comma segment of the address, or "" when the address is a single
 * segment (that one segment is already printed as the locality).
 */
export function barrioFromAddress(address: string): string {
	const segments = addressSegments(address)
	return segments.length > 1 ? segments[0] : ""
}

/** A/C on the invoice: the catalog's "610" or "6102" (the 4th digit is the ACT). */
export function acOf(accountCode: string | null | undefined): string {
	return accountCode?.trim().slice(0, 3) ?? ""
}

/** The Resumen: one row per A/C and ACT, "610- - -X", with that group's total. */
export function resumenGroups(
	lines: { accountCode: string; act: string; amount: number }[],
): { label: string; total: number }[] {
	const groups = new Map<string, number>()
	for (const l of lines) {
		const label = `${l.accountCode}- - -${l.act}`
		groups.set(label, (groups.get(label) ?? 0) + l.amount)
	}
	return [...groups]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([label, total]) => ({ label, total: round2(total) }))
}

/** One or several addresses, separated by commas, semicolons or spaces; null if any is bad. */
export function parsePbccEmails(raw: string): string[] | null {
	const list = raw.split(/[,;\s]+/).filter(Boolean)
	return list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ? list : null
}

/** What PBCC keeps from each advance wire. */
export const PBCC_WIRE_FEE = 30

export function scheduleTotals(
	amounts: number[],
	rate: number,
): { total: number; advance: number } {
	const total = round2(amounts.reduce((s, a) => s + a, 0))
	return { total, advance: round2(total * rate) }
}

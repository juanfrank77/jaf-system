const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** First letter of Brigade.area (C/M/N/O/S), the bank schedule's "area" column. */
export function areaLetter(area: string | null | undefined): string | null {
	const a = area?.trim()
	return a ? a[0].toUpperCase() : null
}

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

export type JobKind = "INSTALACION" | "CONSTRUCCION" | "MANTENIMIENTO"

export function jobKind(jobType: string): JobKind {
	if (jobType === "INSTALL") return "INSTALACION"
	if (jobType === "CONSTRUCTION") return "CONSTRUCCION"
	return "MANTENIMIENTO"
}

export function scheduleTotals(
	amounts: number[],
	rate: number,
): { total: number; advance: number } {
	const total = round2(amounts.reduce((s, a) => s + a, 0))
	return { total, advance: round2(total * rate) }
}

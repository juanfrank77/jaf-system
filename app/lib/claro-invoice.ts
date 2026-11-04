/** Pure rules for the "Factura de Pago - Claro" JAF makes from a PO. */

const MONTHS = [
	"JAN",
	"FEB",
	"MAR",
	"APR",
	"MAY",
	"JUN",
	"JUL",
	"AUG",
	"SEP",
	"OCT",
	"NOV",
	"DEC",
]

/** The M19 series: 4320 -> "M19-4320". */
export function invoiceNumber(seq: number): string {
	return `M19-${seq}`
}

export function isWorkMonth(v: string): boolean {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** "2026-05" -> "MANT-JAF-MAY-2026" (Zona). */
export function zoneOf(workMonth: string): string {
	const [y, m] = workMonth.split("-")
	return `MANT-JAF-${MONTHS[Number(m) - 1]}-${y}`
}

/** This form is month-first: MM/DD/YYYY. */
export function usDate(d: Date | string): string {
	const iso = typeof d === "string" ? d : d.toISOString()
	const [y, m, day] = iso.slice(0, 10).split("-")
	return `${m}/${day}/${y}`
}

/** First and last day of the work month, month-first: "05/01/2026", "05/31/2026". */
export function workRange(workMonth: string): { from: string; to: string } {
	const [y, m] = workMonth.split("-").map(Number)
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
	const mm = String(m).padStart(2, "0")
	return {
		from: `${mm}/01/${y}`,
		to: `${mm}/${String(last).padStart(2, "0")}/${y}`,
	}
}

/** Due date = the day it was loaded in Ariba plus the PO's payment terms. */
export function dueDateOf(loadedAt: Date, termsDays: number): Date {
	const d = new Date(loadedAt)
	d.setUTCDate(d.getUTCDate() + termsDays)
	return d
}

/** Work month to start from: the month the job began, else the month before the PO. */
export function defaultWorkMonth(
	fieldStartedAt: Date | null,
	poDate: Date | null,
): string | null {
	if (fieldStartedAt) return fieldStartedAt.toISOString().slice(0, 7)
	if (!poDate) return null
	const d = new Date(poDate)
	d.setUTCDate(1)
	d.setUTCMonth(d.getUTCMonth() - 1)
	return d.toISOString().slice(0, 7)
}

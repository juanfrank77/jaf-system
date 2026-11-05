/** Pure rules for the "Factura de Pago - Claro" JAF makes from a PO. */

/** Spanish, as on JAF's real invoices: "MANT-JAF-ABR-2026". */
const MONTHS = [
	"ENE",
	"FEB",
	"MAR",
	"ABR",
	"MAY",
	"JUN",
	"JUL",
	"AGO",
	"SEP",
	"OCT",
	"NOV",
	"DIC",
]

/** New invoices. Lissette's old files already use M19-001 onward, so M19 would repeat. */
export const NEW_SERIES = "M20"
export const OLD_SERIES = "M19"

/** { "M20", 1 } -> "M20-001", then on past 999 to "M20-1000". */
export function invoiceNumber(inv: { series: string; seq: number }): string {
	return `${inv.series}-${String(inv.seq).padStart(3, "0")}`
}

/** The series starts at 1 and never resets. */
export function nextSeq(max: number | null): number {
	return max === null ? 1 : max + 1
}

/**
 * "M19-3423", "M193423", "M20-001" or a bare "3423" (series null). A dashless M20
 * is read the same way, since the digits after the series are the number.
 */
export function parseInvoiceRef(
	ref: string,
): { series: string | null; seq: number } | null {
	const t = ref.trim()
	const m = /^M\s?(19|20)\s?[-–]?\s?(\d+)$/i.exec(t)
	if (m) return { series: `M${m[1]}`, seq: Number(m[2]) }
	return /^\d+$/.test(t) ? { series: null, seq: Number(t) } : null
}

/** FECHA on the form: MM/DD/YY on the Puerto Rico calendar. */
export function formDate(d: Date): string {
	return d.toLocaleDateString("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		timeZone: "America/Puerto_Rico",
	})
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

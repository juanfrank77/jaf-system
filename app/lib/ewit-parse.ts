/** What an EWIT "Liquidación Detallada" says. Dates are ISO days; EWIT prints them MM/DD/YYYY. */
export type EwitRead = {
	/** Stored form of "Num. Liquidación", e.g. "JA1616328". */
	number: string | null
	/** "Fecha:" in the blue band (not the print date). */
	invoiceDate: string | null
	periodStart: string | null
	periodEnd: string | null
	/** The "Total:" under the last page's table. */
	total: number | null
	/** Sum of every Importe, to check against the total. */
	linesTotal: number | null
	lineCount: number
}

const money = (s: string) => Number(s.replace(/[,$\s]/g, ""))

/** "07/06/2026" -> "2026-07-06". */
function isoDay(s: string | undefined): string | null {
	const m = s?.match(/^(\d{2})\/(\d{2})\/(20\d{2})$/)
	if (!m) return null
	const [, mm, dd, yyyy] = m
	return Number(mm) >= 1 &&
		Number(mm) <= 12 &&
		Number(dd) >= 1 &&
		Number(dd) <= 31
		? `${yyyy}-${mm}-${dd}`
		: null
}

// A task row ends with quantity, unit price, importe and the budget code.
const LINE_RE =
	/(\d+)\s+\$\s?([\d,]+\.\d{2})\s+\$\s?([\d,]+\.\d{2})\s+RF-[A-Z0-9-]+/g

/** Reads the header, total and rows of an EWIT liquidation from its text. */
export function parseEwitLiquidation(text: string): EwitRead {
	const flat = text.replace(/\s+/g, " ")
	const raw = flat.match(
		/Num\.?\s*Liquidaci[oó]n\s+(JA\s?-?\s?\d[\d-]*\d)/i,
	)?.[1]
	// "JA-16-16328" is stored as "JA1616328" (the form a Payment Advice row normalises to).
	const number = raw ? raw.replace(/[^a-z0-9]/gi, "").toUpperCase() : null
	// "Fecha:" followed by a day; the signature boxes' "Fecha:____" and the
	// "Fecha de impresión" footer do not match.
	const date = flat.match(/\bFecha:\s*(\d{2}\/\d{2}\/20\d{2})/)?.[1]
	const period = flat.match(
		/Periodo:\s*(\d{2}\/\d{2}\/20\d{2})\s*-\s*(\d{2}\/\d{2}\/20\d{2})/i,
	)
	const totals = [...flat.matchAll(/\bTotal:\s*\$\s?([\d,]+\.\d{2})/g)]
	const lines = [...flat.matchAll(LINE_RE)]
	return {
		number,
		invoiceDate: isoDay(date),
		periodStart: isoDay(period?.[1]),
		periodEnd: isoDay(period?.[2]),
		total: totals.length ? money(totals[totals.length - 1][1]) : null,
		linesTotal: lines.length
			? Math.round(lines.reduce((s, l) => s + money(l[3]), 0) * 100) / 100
			: null,
		lineCount: lines.length,
	}
}

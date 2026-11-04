import { parseClaroDate } from "~/lib/po-reading"

/** What a Claro Payment Advice says. Dates are ISO days; Claro writes them day-first. */
export type AdviceRead = {
	adviceDate: string | null
	bank: string | null
	reference: string | null
	/** The total printed on the advice. */
	total: number | null
	rows: {
		/** Normalised "M19-3423" or "JA1616328". */
		invoiceRef: string
		voucher: string | null
		invoiceDate: string | null
		amount: number
		withholding: number
		discount: number
		net: number
	}[]
}

const MONTHS: Record<string, string> = {
	jan: "01",
	ene: "01",
	feb: "02",
	mar: "03",
	apr: "04",
	abr: "04",
	may: "05",
	jun: "06",
	jul: "07",
	aug: "08",
	ago: "08",
	sep: "09",
	oct: "10",
	nov: "11",
	dec: "12",
	dic: "12",
}

/** A JA row is JAF's installer series ("JA1616328"), not an M19 invoice. */
export const isOtherJafRef = (ref: string) => /^JA[-\s]?\d/i.test(ref)

const money = (s: string) => Number(s.replace(/[,$\s]/g, ""))
const MONEY_RE = /\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g
// With a dash any run of digits is a number; without one it needs 3+ ("M193423").
// "JA1616328" is Carmen's installer series Claro pays on the same advice: it may
// be printed with a dash or space, and is normalised to "JA" + digits (the way
// EwitInvoice.number is stored). A dashless ref needs the full 7 digits.
const INVOICE_RE =
	/\b(?:M\s?19\s?(?:[-–]\s?(\d{1,5})|(\d{3,5}))|JA\s?(?:-\s?(\d{5,8})|(\d{7})))\b/gi

/**
 * "Oct. 01, 2026" or "Agosto 28, 2026" -> "2026-10-01". The date is printed
 * where the page breaks fall, so it is looked for in the whole text; a dotted
 * "01.10.2026" is only trusted before the first row (the rows carry their own).
 */
function readAdviceDate(head: string, text: string): string | null {
	for (const named of text.matchAll(
		/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/g,
	)) {
		const m = MONTHS[named[1].toLowerCase()]
		if (m) return `${named[3]}-${m}-${named[2].padStart(2, "0")}`
	}
	const dotted = head.match(/\b\d{1,2}[./]\d{1,2}[./]20\d{2}\b/)
	return dotted ? parseClaroDate(dotted[0].replace(/\//g, ".")) : null
}

/**
 * Reads the rows of an advice from its text. Each invoice number starts a row
 * that runs to the next invoice number; the row's voucher (10 digits), invoice
 * date (day-first) and amounts are taken from inside it. Works whether the text
 * came out one line per row or one cell per line.
 */
export function parseAdvice(text: string): AdviceRead {
	const hits = [...text.matchAll(INVOICE_RE)]
	const head = hits.length > 0 ? text.slice(0, hits[0].index) : text
	const rows: AdviceRead["rows"] = []
	let tail = ""
	hits.forEach((h, i) => {
		const start = (h.index ?? 0) + h[0].length
		let end = hits[i + 1]?.index ?? text.length
		let chunk = text.slice(start, end)
		if (i === hits.length - 1) {
			const t = chunk.search(/\bTotal\b/i)
			if (t >= 0) {
				tail = chunk.slice(t)
				chunk = chunk.slice(0, t)
				end = start + t
			}
		}
		const voucher = chunk.match(/\b\d{10}\b/)?.[0] ?? null
		const dateTok = chunk.match(/\b\d{1,2}\.\d{1,2}\.20\d{2}\b/)?.[0] ?? null
		const amounts = [...chunk.matchAll(MONEY_RE)].map((m) => money(m[0]))
		if (amounts.length === 0) return
		// Columns are amount, withholding, discount, net; a lone figure is all four.
		const [amount, withholding, discount, net] =
			amounts.length >= 4
				? amounts.slice(-4)
				: amounts.length === 1
					? [amounts[0], 0, 0, amounts[0]]
					: [amounts[0], 0, 0, amounts[amounts.length - 1]]
		rows.push({
			invoiceRef: h[3] || h[4] ? `JA${h[3] ?? h[4]}` : `M19-${h[1] ?? h[2]}`,
			voucher,
			invoiceDate: dateTok ? parseClaroDate(dateTok) : null,
			amount,
			withholding,
			discount,
			net,
		})
	})
	const totalText = tail || text.slice(text.search(/\bTotal\b/i))
	const totalHit = /\bTotal\b/i.test(totalText)
		? totalText.match(MONEY_RE)?.[0]
		: undefined
	// "Bank: BANCO SANTANDER PUERTO\nRICO\nBank ID: ..." as Claro prints it, else
	// a bare "Banco ..." line.
	const flat = text.replace(/\s+/g, " ")
	const bank =
		flat.match(/\bBank:\s*(.+?)\s+(?:Bank\s*ID|Reference|Ref\b)/i)?.[1] ??
		text.match(
			/\b(Banco\s+[A-Za-zÁÉÍÓÚáéíóúñ ]+?(?:\s+PR)?)(?=\s*[\n·,\d]|$)/i,
		)?.[1]
	const reference =
		text.match(/(?:Referenc\w*|Reference|Ref\.?)\D{0,12}(\d{8,12})/i)?.[1] ??
		head.match(/\b(\d{10})\b/)?.[1] ??
		null
	return {
		adviceDate: readAdviceDate(head, text),
		bank: bank?.trim() ?? null,
		reference,
		total: totalHit ? money(totalHit) : null,
		rows,
	}
}

import { type PoLine, type PoRead, parseClaroDate } from "~/lib/po-reading"

/**
 * Reads a Claro PO from the PDF's own text layer. Claro's system prints these
 * POs as real text in fixed columns, so nothing has to be guessed: each item row
 * carries its description, then its own Subtotal, IVU and Total at the right.
 * Exact, unlike OCR; scanned POs have no text layer and still go to OCR.
 */

/** One text run as the PDF placed it. `y` grows upward, as in the PDF. */
export type PdfText = { page: number; x: number; y: number; text: string }

type Row = { page: number; y: number; cells: PdfText[] }

const AMOUNT = /^[\d,]*\d\.\d{2}$/
const money = (s: string) => Number(s.replace(/,/g, ""))
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** An item row starts with a five-digit item number in the far-left column. */
const ITEM_NUMBER = /^\d{5}$/
const ITEM_COLUMN_MAX_X = 40
/** Where the description column sits; the delivery date columns start after it. */
const DESC_MIN_X = 130
const DESC_MAX_X = 370
/** Per-item figures sit further right than the PO totals' labels. */
const ITEM_LABEL_MIN_X = 680

function toRows(items: PdfText[]): Row[] {
	const rows: Row[] = []
	const sorted = [...items]
		.filter((i) => i.text.trim() !== "")
		.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
	for (const item of sorted) {
		const last = rows.at(-1)
		if (last && last.page === item.page && Math.abs(last.y - item.y) <= 1.5)
			last.cells.push(item)
		else rows.push({ page: item.page, y: item.y, cells: [item] })
	}
	for (const row of rows) row.cells.sort((a, b) => a.x - b.x)
	return rows
}

const textOf = (c: PdfText) => c.text.trim()

/** The amount printed to the right of a label on the same row. */
function amountAfter(row: Row, label: RegExp, minX = 0): number | null {
	const at = row.cells.findIndex((c) => c.x >= minX && label.test(textOf(c)))
	if (at < 0) return null
	const cell = row.cells.slice(at + 1).find((c) => AMOUNT.test(textOf(c)))
	return cell ? money(textOf(cell)) : null
}

/** The rate is not printed on the PO: the line's IVU says which it is. */
function rateOf(amount: number, ivu: number): number {
	if (amount <= 0) return 0.115
	const rate = ivu / amount
	return Math.abs(rate - 0.04) < Math.abs(rate - 0.115) ? 0.04 : 0.115
}

function readLines(rows: Row[]): PoLine[] {
	const lines: PoLine[] = []
	let open: {
		item: string
		description: string[]
		amount: number | null
		ivu: number | null
	} | null = null
	const close = () => {
		if (open && open.amount !== null) {
			const ivu = open.ivu ?? 0
			lines.push({
				item: open.item,
				description: open.description.join(" ").replace(/\s+/g, " ").trim(),
				amount: open.amount,
				ivuRate: rateOf(open.amount, ivu),
				ivu,
			})
		}
		open = null
	}
	for (const row of rows) {
		const first = row.cells[0]
		if (first.x <= ITEM_COLUMN_MAX_X && ITEM_NUMBER.test(textOf(first))) {
			close()
			open = { item: textOf(first), description: [], amount: null, ivu: null }
		}
		if (!open) continue
		// The PO's own totals close the last item.
		if (row.cells.some((c) => /^Total USD$/.test(textOf(c)))) {
			close()
			continue
		}
		const subtotal = amountAfter(row, /^Subtotal$/, ITEM_LABEL_MIN_X)
		if (subtotal !== null && open.amount === null) open.amount = subtotal
		const ivu = amountAfter(row, /^IVU$/, ITEM_LABEL_MIN_X)
		if (ivu !== null && open.ivu === null) open.ivu = ivu
		for (const c of row.cells)
			if (c.x >= DESC_MIN_X && c.x < DESC_MAX_X)
				open.description.push(textOf(c))
	}
	close()
	return lines
}

/** 8-digit Aviso numbers: the conditions box first, then the PO's notes. */
function readAvisos(items: PdfText[]): string[] {
	const isAviso = (t: string) => /^\d{8}$/.test(t.trim())
	const box = items.filter(
		(i) => i.page === 1 && i.x >= 600 && i.y >= 500 && isAviso(i.text),
	)
	const notes = items.filter((i) => i.page > 1 && i.x <= 40 && isAviso(i.text))
	return [...new Set([...box, ...notes].map((i) => i.text.trim()))]
}

/**
 * Whether a text-layer reading can be trusted: its lines add up to its totals. A
 * scan can carry an embedded OCR layer full of misread digits, which reads as
 * text but will not add up; that one goes through our own OCR instead.
 */
export function isSoundPoRead(read: PoRead): boolean {
	if (read.lines.length === 0 || read.subtotal === null || read.total === null)
		return false
	const cents = (n: number) => Math.round(n * 100)
	const lineSum = read.lines.reduce((sum, l) => sum + cents(l.amount), 0)
	const ivu = read.lines.reduce((sum, l) => sum + cents(l.ivu), 0)
	return lineSum === cents(read.subtotal) && lineSum + ivu === cents(read.total)
}

export function parsePoText(items: PdfText[]): PoRead {
	const rows = toRows(items)
	const page1 = items.filter((i) => i.page === 1)
	const poNumber =
		page1
			.find((i) => i.x < 120 && /^\d{10}$/.test(i.text.trim()))
			?.text.trim() ?? null
	const dateRow = rows.find(
		(r) => r.page === 1 && r.cells.some((c) => /\bde\/of\b/i.test(textOf(c))),
	)
	const poDate = parseClaroDate(
		dateRow?.cells.find((c) => /^\d{2}\.\d{2}\.\d{4}$/.test(textOf(c)))?.text,
	)
	const stated = dateRow?.cells
		.map((c) => textOf(c).match(/\bde\/of\s*(\d+)/i)?.[1])
		.find(Boolean)
	// Most POs spell the terms out; some only carry Claro's code, K010 = 60 days.
	const terms =
		page1
			.map((i) => i.text.match(/VENCIMIENTO EN (\d+)/i)?.[1])
			.find(Boolean) ??
		(page1.some((i) => i.text.trim() === "K010") ? "60" : undefined)
	const lines = readLines(rows)
	let subtotal: number | null = null
	let ivu: number | null = null
	let total: number | null = null
	for (const row of rows) {
		// The items' own Subtotal sits further right than the PO's.
		const poLabel = row.cells.find(
			(c) => c.x < ITEM_LABEL_MIN_X && /^Subtotal$/.test(textOf(c)),
		)
		if (poLabel) subtotal ??= amountAfter(row, /^Subtotal$/)
		ivu ??= amountAfter(row, /^Total IVU$/)
		total ??= amountAfter(row, /^Total USD$/)
	}
	const sumIvu = (rate: number) =>
		r2(lines.filter((l) => l.ivuRate === rate).reduce((s, l) => s + l.ivu, 0))
	return {
		poNumber,
		poDate,
		statedPages: stated ? Number(stated) : null,
		termsDays: terms ? Number(terms) : null,
		avisoCandidates: readAvisos(items),
		lines,
		subtotal,
		ivu4: lines.length > 0 ? sumIvu(0.04) : null,
		ivu115: lines.length > 0 ? sumIvu(0.115) : ivu,
		total,
	}
}

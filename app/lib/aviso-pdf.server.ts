import { extractText } from "unpdf"

export type AvisoPdfRow = {
	claroCode: string
	qtyInitial: number
	qtyUsed: number
}

export type ParsedAviso = { avisoNumber: string; rows: AvisoPdfRow[] }

export type AvisoPdfErrorCode =
	| "unreadable"
	| "no_number"
	| "multiple_numbers"
	| "no_rows"

export class AvisoPdfError extends Error {
	constructor(readonly code: AvisoPdfErrorCode) {
		super(code)
		this.name = "AvisoPdfError"
	}
}

export const normaliseAvisoNumber = (s: string) => s.replace(/\D/g, "")

const SERVICES_START = /SERVICIOS REALIZADOS TOTALES/
const SERVICES_END = /MATERIALES USADOS TOTALES/
const ROW_START = /^(\d{8})\s/
// Initial, used, difference, hours — the last line of every service row.
const ROW_QTYS =
	/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?$/

/** Pure parser over the merged text of a Claro Aviso print. */
export function parseAvisoText(text: string): ParsedAviso {
	const numbers = new Set(
		[...text.matchAll(/Aviso\s*#\s*(\d{8})/g)].map((m) => m[1]),
	)
	if (numbers.size === 0) throw new AvisoPdfError("no_number")
	if (numbers.size > 1) throw new AvisoPdfError("multiple_numbers")

	const start = text.search(SERVICES_START)
	const section = start === -1 ? "" : text.slice(start)
	const end = section.search(SERVICES_END)
	const lines = (end === -1 ? section : section.slice(0, end)).split("\n")

	const rows: AvisoPdfRow[] = []
	let current: string | null = null
	for (const raw of lines) {
		const line = raw.trim()
		const started = line.match(ROW_START)
		if (started) {
			current = started[1]
			continue
		}
		const qtys = current && line.match(ROW_QTYS)
		if (current && qtys) {
			rows.push({
				claroCode: current,
				qtyInitial: Number(qtys[1]),
				qtyUsed: Number(qtys[2]),
			})
			current = null
		}
	}
	if (rows.length === 0) throw new AvisoPdfError("no_rows")
	return { avisoNumber: [...numbers][0], rows }
}

/** Extracts the text layer (no OCR) and parses it. */
export async function readAvisoPdf(bytes: Uint8Array): Promise<ParsedAviso> {
	let text: string
	try {
		const { text: extracted } = await extractText(bytes, {
			mergePages: true,
		})
		text = extracted
	} catch {
		throw new AvisoPdfError("unreadable")
	}
	return parseAvisoText(text)
}

export type AvisoMaterialRow = { claroCode: string; used: number }
export type MaterialDifference = {
	claroCode: string
	name: string
	workOrder: number
	aviso: number
}

const SECTION = /MATERIALES\s+USADOS/
const SECTION_LINE = /^(MATERIALES\s+USADOS\s+TOTALES\s*)+$/
const EMPTY = /^No\s+items\s+to\s+show\.*$/i
const END = /^Comentarios$/i
const INT = /^\d+$/
// A material number as Claro prints it: digits only (checked against the catalog).
const CODE = /^\d{6,8}$/
const HEADER_WORDS = new Set([
	"NUMERO",
	"DE",
	"MATERIAL",
	"DESCRIPCION",
	"CUENTA",
	"CANTIDAD",
	"INICIAL",
	"USADA",
	"DEVOLVER",
])
// Page chrome of a Claro print, repeated on every page: skipped so a table can
// continue onto the next page. Nothing else is ever skipped.
const CHROME = [
	/^Todos los derechos reservados\b/i, // page footer
	/^Incidencias\s+Mesa\s+de\s+Control\b/i, // app nav bar under the footer
	/^https?:\/\/\S+$/i, // browser print header/footer: URL
	/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*[AP]M\b/i, // browser print header: date
	/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]M$/, // block timestamp
	/^\d+\s*\/\s*\d+$/, // browser page counter
	/^[\uE000-\uF8FF\s]+$/, // icon glyphs only
]

const stripAccents = (s: string) =>
	s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
const isHeaderLine = (line: string) =>
	line
		.split(/\s+/)
		.every((w) => HEADER_WORDS.has(stripAccents(w).toUpperCase()))

/** code, description (ending in a non-number), initial, used, return. */
function parseRow(
	line: string,
): { code: string; initial: number; used: number; ret: number } | null {
	const tokens = line.split(/\s+/)
	if (tokens.length < 5 || !CODE.test(tokens[0])) return null
	const [last4, initial, used, ret] = tokens.slice(-4)
	if (![initial, used, ret].every((t) => INT.test(t))) return null
	// Exactly three trailing integers: a description ending in a number leaves
	// the columns ambiguous (e.g. quantities wrapped to the next line).
	if (INT.test(last4)) return null
	return {
		code: tokens[0],
		initial: Number(initial),
		used: Number(used),
		ret: Number(ret),
	}
}

/**
 * Best-effort read of the "MATERIALES USADOS TOTALES" table of an Aviso print.
 * Returns the rows (code + cantidad usada), `[]` for the explicit empty table,
 * or `null` whenever it cannot place everything with confidence. Never guesses:
 * between the section heading and the `Comentarios` line every line must be a
 * column-header line (before any row), the empty marker (as the only content),
 * a well-formed row of a known, not repeated code whose quantities add up
 * (initial = used + return), or known page chrome. Anything else is null.
 */
export function parseAvisoMaterials(
	text: string,
	knownCodes: ReadonlySet<string>,
): AvisoMaterialRow[] | null {
	const at = text.search(SECTION)
	if (at < 0) return null
	const lines = text
		.slice(at)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
	if (!SECTION_LINE.test(lines[0] ?? "")) return null
	const rows: AvisoMaterialRow[] = []
	const seen = new Set<string>()
	let empties = 0
	let ended = false
	for (const line of lines.slice(1)) {
		if (END.test(line)) {
			ended = true
			break
		}
		if (CHROME.some((re) => re.test(line))) continue
		if (rows.length === 0 && empties === 0 && isHeaderLine(line)) continue
		if (EMPTY.test(line)) {
			empties++
			continue
		}
		const row = parseRow(line)
		if (!row || row.initial !== row.used + row.ret) return null
		if (!knownCodes.has(row.code) || seen.has(row.code)) return null
		seen.add(row.code)
		rows.push({ claroCode: row.code, used: row.used })
	}
	if (!ended) return null
	if (empties === 0) return rows.length > 0 ? rows : null
	return empties === 1 && rows.length === 0 ? [] : null
}

/** Differences between what the work order says and what the Aviso shows. */
export function compareMaterials(
	workOrder: { claroCode: string; name: string; used: number }[],
	aviso: AvisoMaterialRow[],
): MaterialDifference[] {
	const wo = new Map<string, { name: string; used: number }>()
	for (const l of workOrder) {
		const cur = wo.get(l.claroCode)
		wo.set(l.claroCode, {
			name: cur?.name ?? l.name,
			used: (cur?.used ?? 0) + l.used,
		})
	}
	const av = new Map<string, number>()
	for (const r of aviso)
		av.set(r.claroCode, (av.get(r.claroCode) ?? 0) + r.used)
	const out: MaterialDifference[] = []
	for (const code of new Set([...wo.keys(), ...av.keys()])) {
		const w = wo.get(code)
		const workOrderQty = w?.used ?? 0
		const avisoQty = av.get(code) ?? 0
		if (workOrderQty !== avisoQty)
			out.push({
				claroCode: code,
				name: w?.name ?? code,
				workOrder: workOrderQty,
				aviso: avisoQty,
			})
	}
	return out.sort((a, b) => a.claroCode.localeCompare(b.claroCode))
}

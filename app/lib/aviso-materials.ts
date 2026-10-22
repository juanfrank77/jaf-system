export type AvisoMaterialRow = { claroCode: string; used: number }
export type MaterialDifference = {
	claroCode: string
	name: string
	workOrder: number
	aviso: number
}

const SECTION = /MATERIALES\s+USADOS/
const EMPTY = /No\s+items\s+to\s+show/i
const END = /^(Comentarios|Todos los derechos)/i
const INT = /^\d+$/
// A token that looks like a material number (digits, maybe OCR-garbled).
const CODE_LIKE = /^(?=[0-9A-Za-z]*\d)[0-9A-Za-z]{6,8}$/

/**
 * Best-effort read of the "MATERIALES USADOS TOTALES" table of an Aviso print.
 * Returns the rows (code + cantidad usada), `[]` for the explicit empty table,
 * or `null` whenever it cannot place everything with confidence (OCR noise,
 * unknown code, duplicate code, odd quantity, missing section). Never guesses.
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
	const rows: AvisoMaterialRow[] = []
	const seen = new Set<string>()
	let sawEmpty = false
	for (const line of lines) {
		if (END.test(line)) break
		if (EMPTY.test(line)) {
			sawEmpty = true
			continue
		}
		const tokens = line.split(/\s+/)
		if (!CODE_LIKE.test(tokens[0])) continue
		// A row: code, description/cuenta, then initial, used, return.
		if (tokens.length < 5) return null
		const [initial, used, ret] = tokens.slice(-3)
		if (!INT.test(initial) || !INT.test(used) || !INT.test(ret)) return null
		const code = tokens[0]
		if (!knownCodes.has(code) || seen.has(code)) return null
		seen.add(code)
		rows.push({ claroCode: code, used: Number(used) })
	}
	if (rows.length > 0) return sawEmpty ? null : rows
	return sawEmpty ? [] : null
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

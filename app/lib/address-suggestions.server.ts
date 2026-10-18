import { canonicalize, normalizeKey } from "./address-normalize"
import { db } from "./db.server"
import type { AddressInput } from "./intake-address"

type Column = "tipo" | "tipoPlanta" | "grupoPlan"

/** Distinct (by normalised key) values of a column, most used first. */
async function distinctValues(column: Column): Promise<string[]> {
	const rows = await db.jafInvoice.groupBy({
		by: [column],
		where: { [column]: { not: null } },
		_count: { _all: true },
	})
	const byKey = new Map<
		string,
		{ total: number; best: string; bestCount: number }
	>()
	for (const r of rows) {
		const value = (r[column] as string | null)?.replace(/\s+/g, " ").trim()
		if (!value) continue
		const count = r._count._all
		const key = normalizeKey(value)
		const cur = byKey.get(key)
		if (!cur) {
			byKey.set(key, { total: count, best: value, bestCount: count })
		} else {
			cur.total += count
			if (count > cur.bestCount) {
				cur.best = value
				cur.bestCount = count
			}
		}
	}
	return [...byKey.values()]
		.sort((a, b) => b.total - a.total || a.best.localeCompare(b.best))
		.map((v) => v.best)
}

export async function loadAddressSuggestions(): Promise<{
	tipo: string[]
	tipoPlanta: string[]
	grupoPlan: string[]
}> {
	const [tipo, tipoPlanta, grupoPlan] = await Promise.all([
		distinctValues("tipo"),
		distinctValues("tipoPlanta"),
		distinctValues("grupoPlan"),
	])
	return { tipo, tipoPlanta, grupoPlan }
}

export async function canonicalizeAddress(
	a: AddressInput,
): Promise<AddressInput> {
	const s = await loadAddressSuggestions()
	return {
		...a,
		tipo: canonicalize(a.tipo, s.tipo),
		tipoPlanta: canonicalize(a.tipoPlanta, s.tipoPlanta),
		grupoPlan: canonicalize(a.grupoPlan, s.grupoPlan),
	}
}

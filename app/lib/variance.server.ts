type Signals = { overage: number; shortage: number; discrepancy: number }

type MaterialLine = { serviceCodeId: string; qty: number }

function toMaterialLines(value: unknown): MaterialLine[] {
	if (!Array.isArray(value)) return []
	return value.filter((i): i is MaterialLine => {
		if (typeof i !== "object" || i === null) return false
		const item = i as Record<string, unknown>
		return (
			typeof item.serviceCodeId === "string" && typeof item.qty === "number"
		)
	})
}

/**
 * Builds per-line ordered/installed/delta rows for a single doc, comparing
 * what was estimated at intake against what the crew reports installed
 * (falling back to what warehouse released, if the crew hasn't reported yet).
 */
export function buildVarianceLines(doc: {
	estimatedMaterials?: unknown
	materialsTaken?: unknown
	materialsUsed?: unknown
}): VarianceLine[] {
	const ordered = toMaterialLines(doc.estimatedMaterials)
	const taken = toMaterialLines(doc.materialsTaken)
	const used = toMaterialLines(doc.materialsUsed)

	const orderedMap = new Map(ordered.map((l) => [l.serviceCodeId, l.qty]))
	const takenMap = new Map(taken.map((l) => [l.serviceCodeId, l.qty]))
	const usedMap = new Map(used.map((l) => [l.serviceCodeId, l.qty]))

	const codes = new Set([
		...orderedMap.keys(),
		...takenMap.keys(),
		...usedMap.keys(),
	])

	return [...codes].map((code) => {
		const orderedQty = orderedMap.get(code) ?? 0
		const installedQty = usedMap.has(code)
			? (usedMap.get(code) ?? 0)
			: (takenMap.get(code) ?? 0)
		return {
			code,
			ordered: orderedQty,
			installed: installedQty,
			delta: installedQty - orderedQty,
		}
	})
}

export type VarianceLine = {
	code: string
	ordered: number
	installed: number
	delta: number
}

export type VarianceRow = {
	docId: string
	claroOrderNo: string
	brigade: string
	kinds: ("overage" | "discrepancy" | "shortage")[]
	lines: VarianceLine[]
}

/**
 * Reduces per-doc material signals into consolidated variance rows.
 *
 * A doc can have more than one kind of variance at once (e.g. an overage on
 * one line and a shortage on another) — every matching kind for a doc is
 * returned, never just the first match.
 */
export function collectVariance(
	docs: {
		id: string
		claroOrderNo: string
		brigade: string
		signals: Signals
		lines: VarianceLine[]
	}[],
): VarianceRow[] {
	return docs.flatMap((d) => {
		const kinds = (["overage", "discrepancy", "shortage"] as const).filter(
			(k) => d.signals[k] > 0,
		)
		return kinds.length
			? [
					{
						docId: d.id,
						claroOrderNo: d.claroOrderNo,
						brigade: d.brigade,
						kinds: [...kinds],
						lines: d.lines,
					},
				]
			: []
	})
}

// Pure, framework/server-agnostic helpers for the doc-returns flow — shared by
// the route's loader/action (server) and its presentational form component
// (client/browser-test bundle), so neither side duplicates the taken−used
// arithmetic and the client bundle never has to import server-only code just
// to reuse it.

export type MaterialLine = { serviceCodeId: string; qty: number }
export type UsedLine = { serviceCodeId: string; qty: number }

// taken − used, floored at 0 — the crew's field number, never negative.
export function expectedBackFor(takenQty: number, usedQty: number) {
	return Math.max(0, (takenQty || 0) - (usedQty || 0))
}

export interface ExpectedBackLine {
	serviceCodeId: string
	takenQty: number
	usedQty: number
	expectedBack: number
}

export function computeExpectedBackLines(
	taken: MaterialLine[],
	materialsUsed: UsedLine[] | null,
): ExpectedBackLine[] {
	const usedMap = Object.fromEntries(
		(materialsUsed || []).map((u) => [u.serviceCodeId, u.qty]),
	)
	return taken
		.filter((t) => t.serviceCodeId)
		.map((t) => {
			const takenQty = t.qty || 0
			const usedQty = usedMap[t.serviceCodeId] ?? 0
			return {
				serviceCodeId: t.serviceCodeId,
				takenQty,
				usedQty,
				expectedBack: expectedBackFor(takenQty, usedQty),
			}
		})
}

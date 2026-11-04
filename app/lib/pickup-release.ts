export type MaterialLine = { serviceCodeId: string; qty: number }

/** The total taken so far plus this release: each code once, first-seen order. */
export function addTaken(
	taken: MaterialLine[],
	release: MaterialLine[],
): MaterialLine[] {
	const total = new Map<string, number>()
	for (const l of [...taken, ...release])
		total.set(l.serviceCodeId, (total.get(l.serviceCodeId) ?? 0) + l.qty)
	return [...total].map(([serviceCodeId, qty]) => ({ serviceCodeId, qty }))
}

/** What is still left on the request after earlier releases; none below zero. */
export function remainingToTake(
	estimated: MaterialLine[],
	taken: MaterialLine[],
): MaterialLine[] {
	const already = new Map(taken.map((l) => [l.serviceCodeId, l.qty]))
	return estimated.flatMap((l) => {
		const qty = l.qty - (already.get(l.serviceCodeId) ?? 0)
		return qty > 0 ? [{ serviceCodeId: l.serviceCodeId, qty }] : []
	})
}

/**
 * The lines this release pushed over the request: compares the running total to
 * the estimate, for the codes on this release only, so an earlier overage is not
 * flagged again by a later release that took none of it.
 */
export function releaseOverages(
	release: MaterialLine[],
	takenAfter: MaterialLine[],
	estimated: MaterialLine[],
): { serviceCodeId: string; estimatedQty: number; takenQty: number }[] {
	const est = new Map(estimated.map((l) => [l.serviceCodeId, l.qty]))
	const total = new Map(takenAfter.map((l) => [l.serviceCodeId, l.qty]))
	return release.flatMap((l) => {
		const estimatedQty = est.get(l.serviceCodeId) ?? 0
		const takenQty = total.get(l.serviceCodeId) ?? l.qty
		return takenQty > estimatedQty
			? [{ serviceCodeId: l.serviceCodeId, estimatedQty, takenQty }]
			: []
	})
}

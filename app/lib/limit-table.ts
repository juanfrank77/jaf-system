export function pickBracket(dropFt: number, brackets: number[]): number {
	const sorted = [...brackets].sort((a, b) => a - b)
	return sorted.find((b) => dropFt <= b) ?? sorted[sorted.length - 1]
}

export function prefillAccessories(
	bracketRows: { bracketFt: number; serviceCodeId: string; qty: number }[],
	bracket: number,
) {
	return bracketRows
		.filter((r) => r.bracketFt === bracket)
		.map((r) => ({
			serviceCodeId: r.serviceCodeId,
			prefilledQty: r.qty,
			qty: r.qty,
		}))
}

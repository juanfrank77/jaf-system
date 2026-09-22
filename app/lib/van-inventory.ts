export type StockLevel = {
	serviceCodeId: string
	qty: number
}

export type RestockItem = {
	serviceCodeId: string
	qty: number
}

type InventoryTransaction = {
	serviceCodeId: string
	qty: number
	type: string
}

export function computeVanInventory(
	transactions: InventoryTransaction[],
): Map<string, number> {
	const inventory = new Map<string, number>()
	for (const tx of transactions) {
		inventory.set(
			tx.serviceCodeId,
			(inventory.get(tx.serviceCodeId) ?? 0) + tx.qty,
		)
	}
	return inventory
}

export function getOnHand(
	transactions: InventoryTransaction[],
	serviceCodeId: string,
): number {
	return computeVanInventory(transactions).get(serviceCodeId) ?? 0
}

/** On-hand plus in-flight restock (same inputs as {@link evaluateRestockApproval}). */
export function getEffectiveOnHand(
	transactions: InventoryTransaction[],
	serviceCodeId: string,
): number {
	return computeVanInventory(transactions).get(serviceCodeId) ?? 0
}

/** Prefill request qty: max(0, par − on van). Van ledger only — not pending requests. */
export function computeRestockPrefillQty(
	serviceCodeId: string,
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
): number {
	const standard =
		standardLevels.find((l) => l.serviceCodeId === serviceCodeId)?.qty ?? 0
	if (standard <= 0) return 0
	const onVan = getOnHand(transactions, serviceCodeId)
	return Math.max(0, standard - onVan)
}

/** Map of serviceCodeId → prefill qty for rows below par (empty when at/above par or no par). */
export function buildRestockPrefillMap(
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
): Record<string, number> {
	const result: Record<string, number> = {}
	for (const level of standardLevels) {
		const qty = computeRestockPrefillQty(
			level.serviceCodeId,
			transactions,
			standardLevels,
		)
		if (qty > 0) result[level.serviceCodeId] = qty
	}
	return result
}

export function evaluateRestockApproval(
	items: RestockItem[],
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
): { requiresApproval: boolean; reasons: string[] } {
	const standardMap = new Map(
		standardLevels.map((l) => [l.serviceCodeId, l.qty]),
	)
	const reasons: string[] = []

	for (const item of items) {
		const current = getEffectiveOnHand(transactions, item.serviceCodeId)
		const standard = standardMap.get(item.serviceCodeId) ?? 0
		if (current + item.qty > standard) {
			reasons.push(item.serviceCodeId)
		}
	}

	return { requiresApproval: reasons.length > 0, reasons }
}

/** Lines in the request that exceed par (same rules as {@link evaluateRestockApproval}). */
export function countRestockLinesRequiringApproval(
	items: RestockItem[],
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
): number {
	return evaluateRestockApproval(items, transactions, standardLevels).reasons
		.length
}

export function buildInventoryComparison(
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
	serviceCodeMap: Map<string, { claroCode: string; name: string }>,
): {
	serviceCodeId: string
	claroCode: string
	name: string
	onHand: number
	standard: number
	delta: number
}[] {
	const inventory = computeVanInventory(transactions)
	const standardMap = new Map(
		standardLevels.map((l) => [l.serviceCodeId, l.qty]),
	)
	const allServiceCodeIds = new Set([
		...standardLevels.map((l) => l.serviceCodeId),
		...transactions.map((t) => t.serviceCodeId),
	])

	return Array.from(allServiceCodeIds)
		.map((serviceCodeId) => {
			const code = serviceCodeMap.get(serviceCodeId)
			const onHand = inventory.get(serviceCodeId) ?? 0
			const standard = standardMap.get(serviceCodeId) ?? 0
			return {
				serviceCodeId,
				claroCode: code?.claroCode ?? serviceCodeId,
				name: code?.name ?? "Unknown",
				onHand,
				standard,
				delta: onHand - standard,
			}
		})
		.sort((a, b) => a.claroCode.localeCompare(b.claroCode))
}

export type StockLevel = {
	serviceCodeId: string
	qty: number
}

export type RestockItem = {
	serviceCodeId: string
	qty: number
}

export type InventoryTransaction = {
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

export function evaluateRestockApproval(
	items: RestockItem[],
	transactions: InventoryTransaction[],
	standardLevels: StockLevel[],
): { requiresApproval: boolean; reasons: string[] } {
	const inventory = computeVanInventory(transactions)
	const standardMap = new Map(
		standardLevels.map((l) => [l.serviceCodeId, l.qty]),
	)
	const reasons: string[] = []

	for (const item of items) {
		const current = inventory.get(item.serviceCodeId) ?? 0
		const standard = standardMap.get(item.serviceCodeId) ?? 0
		if (current + item.qty > standard) {
			reasons.push(item.serviceCodeId)
		}
	}

	return { requiresApproval: reasons.length > 0, reasons }
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

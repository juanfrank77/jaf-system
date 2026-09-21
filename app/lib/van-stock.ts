import { buildInventoryComparison, type StockLevel } from "./van-inventory"

export type ParLevel = {
	serviceCodeId: string
	parLevel: number
}

export type ParseSkip = {
	reason:
		| "not_array"
		| "invalid_entry"
		| "missing_service_code_id"
		| "invalid_qty"
		| "duplicate_service_code_id"
	entry?: unknown
}

export type ParseLegacyResult = {
	levels: ParLevel[]
	skips: ParseSkip[]
}

type LegacyEntry = {
	serviceCodeId?: unknown
	qty?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseQty(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return null
}

/** Parser for Van.standardStockLevels JSON entries that require serviceCodeId + qty. */
export function parseLegacyStockLevels(json: unknown): ParseLegacyResult {
	if (!Array.isArray(json)) {
		return {
			levels: [],
			skips: [{ reason: "not_array", entry: json }],
		}
	}

	const levels: ParLevel[] = []
	const skips: ParseSkip[] = []
	const seen = new Set<string>()

	for (const entry of json) {
		if (!isPlainObject(entry)) {
			skips.push({ reason: "invalid_entry", entry })
			continue
		}

		const { serviceCodeId, qty } = entry as LegacyEntry
		if (!("serviceCodeId" in entry)) {
			skips.push({ reason: "missing_service_code_id", entry })
			continue
		}
		if (typeof serviceCodeId !== "string" || !serviceCodeId.trim()) {
			skips.push({ reason: "missing_service_code_id", entry })
			continue
		}

		if (!("qty" in entry)) {
			skips.push({ reason: "invalid_qty", entry })
			continue
		}
		const parsedQty = parseQty(qty)
		if (parsedQty === null) {
			skips.push({ reason: "invalid_qty", entry })
			continue
		}

		if (seen.has(serviceCodeId)) {
			skips.push({ reason: "duplicate_service_code_id", entry })
			continue
		}

		seen.add(serviceCodeId)
		levels.push({ serviceCodeId, parLevel: parsedQty })
	}

	return { levels, skips }
}

export function parLevelsToStockLevels(levels: ParLevel[]): StockLevel[] {
	return levels.map((level) => ({
		serviceCodeId: level.serviceCodeId,
		qty: level.parLevel,
	}))
}

export function stockLevelsToLegacyJson(
	levels: ParLevel[],
): { serviceCodeId: string; qty: number }[] {
	return levels.map((level) => ({
		serviceCodeId: level.serviceCodeId,
		qty: level.parLevel,
	}))
}

export type ParStatusLine = {
	serviceCodeId: string
	onHand: number
	parLevel: number
}

/** Par KPI input for PR 2. Does not compute units owed back (blocked on SerialUnit #16). */
export function computeParStatus({
	parLevels,
	transactions,
}: {
	parLevels: ParLevel[]
	transactions: { serviceCodeId: string; qty: number; type?: string }[]
}): {
	hasParLevels: boolean
	belowParCount: number
	belowParLines: ParStatusLine[]
} {
	const hasParLevels = parLevels.length > 0
	if (!hasParLevels) {
		return { hasParLevels: false, belowParCount: 0, belowParLines: [] }
	}

	const stockLevels = parLevelsToStockLevels(parLevels)
	const comparison = buildInventoryComparison(
		transactions.map((tx) => ({ ...tx, type: tx.type ?? "UNKNOWN" })),
		stockLevels,
		new Map(),
	)
	const belowParLines = comparison
		.filter((line) => line.onHand < line.standard)
		.map((line) => ({
			serviceCodeId: line.serviceCodeId,
			onHand: line.onHand,
			parLevel: line.standard,
		}))

	return {
		hasParLevels: true,
		belowParCount: belowParLines.length,
		belowParLines,
	}
}

import type { ParseKeys } from "i18next"

/**
 * Where a Field material line came from. Only WAREHOUSE_ISSUE material is
 * billable; the other four are recorded for tracking.
 */
export const MATERIAL_SOURCES = [
	"WAREHOUSE_ISSUE",
	"EXISTING_AT_SITE",
	"CLARO_DROP_OFF",
	"TRUCK_STOCK",
	"CREW_PERSONAL",
] as const

export type MaterialSource = (typeof MATERIAL_SOURCES)[number]

/** Values stored before the five Sources existed. */
const LEGACY: Record<string, MaterialSource> = {
	WAREHOUSE: "WAREHOUSE_ISSUE",
	BRIGADE_STOCK: "TRUCK_STOCK",
}

function isMaterialSource(raw: unknown): raw is MaterialSource {
	return (MATERIAL_SOURCES as readonly unknown[]).includes(raw)
}

/** A stored or posted value as a current Source (old rows keep working). */
export function normaliseSource(raw: unknown): MaterialSource {
	if (isMaterialSource(raw)) return raw
	if (typeof raw === "string" && raw in LEGACY) return LEGACY[raw]
	return "WAREHOUSE_ISSUE"
}

/** Whether the Source is a legacy value or a current one. */
export function isKnownSource(raw: unknown): boolean {
	return isMaterialSource(raw) || (typeof raw === "string" && raw in LEGACY)
}

export function isBillableSource(s: MaterialSource): boolean {
	return s === "WAREHOUSE_ISSUE"
}

const KEYS: Record<MaterialSource, ParseKeys> = {
	WAREHOUSE_ISSUE: "docs_field.materials.source_warehouse_issue",
	EXISTING_AT_SITE: "docs_field.materials.source_existing_at_site",
	CLARO_DROP_OFF: "docs_field.materials.source_claro_drop_off",
	TRUCK_STOCK: "docs_field.materials.source_truck_stock",
	CREW_PERSONAL: "docs_field.materials.source_crew_personal",
}

export function sourceLabelKey(s: MaterialSource): ParseKeys {
	return KEYS[s]
}

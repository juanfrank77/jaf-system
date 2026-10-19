import { db } from "./db.server"
import {
	type BrigadeStockLine,
	brigadeStockLines,
	brigadeStockTracked,
} from "./field-materials"

/**
 * The read-only "Brigade's stock (tracked, not billed)" list for a job. Its
 * codes are looked up by id, so a code deactivated since still shows its name.
 */
export async function brigadeStockFor(
	fieldMaterials: unknown,
): Promise<BrigadeStockLine[]> {
	const ids = brigadeStockLines(fieldMaterials).map((l) => l.serviceCodeId)
	if (ids.length === 0) return []
	const codes = await db.serviceCode.findMany({ where: { id: { in: ids } } })
	return brigadeStockTracked(fieldMaterials, codes)
}

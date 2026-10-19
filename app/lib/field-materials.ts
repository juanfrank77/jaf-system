/**
 * The Field step's one materials table (spec "Step 3 · Field"). It is a
 * presentation over the canonical JSON columns: `fieldMaterials` keeps the
 * supervisor's rows (with the source), and `materialsUsed` receives the
 * billable used quantities so Finance, pre-cert and the PDFs read what they
 * always did.
 *
 * Provisional ruling (pending Monica / Lissette): the brigade's own stock is
 * recorded (BRIGADE_STOCK rows in `fieldMaterials`) for tracking only and
 * kept off the billable lines, so `materialsUsed` carries WAREHOUSE use only.
 */
export type FieldMaterialSource = "WAREHOUSE" | "BRIGADE_STOCK"

export type FieldMaterialRow = {
	serviceCodeId: string
	used: number
	returned: number
	source: FieldMaterialSource
}

type MaterialLine = { serviceCodeId: string; qty: number }

const SOURCES: readonly FieldMaterialSource[] = ["WAREHOUSE", "BRIGADE_STOCK"]

function quantity(v: unknown): number {
	if (v === undefined || v === null || v === "") return 0
	const n = Number(v)
	if (!Number.isFinite(n) || n < 0) throw new Error("Invalid quantity")
	return n
}

function toRows(value: unknown): FieldMaterialRow[] {
	if (!Array.isArray(value)) throw new Error("Materials must be a list")
	const rows: FieldMaterialRow[] = []
	for (const r of value) {
		if (!r || typeof r !== "object") throw new Error("Invalid materials row")
		const { serviceCodeId, used, returned, source } = r as Record<
			string,
			unknown
		>
		if (typeof serviceCodeId !== "string" || !serviceCodeId) continue
		const s = source ?? "WAREHOUSE"
		if (!SOURCES.includes(s as FieldMaterialSource))
			throw new Error("Invalid materials source")
		rows.push({
			serviceCodeId,
			used: quantity(used),
			returned: quantity(returned),
			source: s as FieldMaterialSource,
		})
	}
	return rows
}

/** Rows from the posted JSON. Throws on anything that is not a valid table. */
export function parseFieldMaterials(raw: string | null): FieldMaterialRow[] {
	if (!raw) return []
	return toRows(JSON.parse(raw))
}

/** The stored rows, or one WAREHOUSE row per signed-out line (used = signed). */
export function fieldMaterialsOrDefault(
	stored: unknown,
	taken: MaterialLine[],
): FieldMaterialRow[] {
	try {
		const rows = toRows(stored)
		if (rows.length > 0) return rows
	} catch {
		// Nothing (or nothing readable) stored yet: start from the pickup.
	}
	return taken.map((t) => ({
		serviceCodeId: t.serviceCodeId,
		used: t.qty,
		returned: 0,
		source: "WAREHOUSE",
	}))
}

/**
 * `materialsUsed` shape: one line per code with WAREHOUSE use > 0. Brigade's
 * stock stays off the billable lines (see `brigadeStockLines`).
 */
export function billableUsed(rows: FieldMaterialRow[]): MaterialLine[] {
	return [...warehouseUsed(rows)]
		.filter(([, qty]) => qty > 0)
		.map(([serviceCodeId, qty]) => ({ serviceCodeId, qty }))
}

function storedRows(fieldMaterials: unknown): FieldMaterialRow[] {
	try {
		return toRows(fieldMaterials)
	} catch {
		// Nothing (or nothing readable) stored: a job from before the table.
		return []
	}
}

/** One line of the read-only "Brigade's stock (tracked, not billed)" list. */
export type BrigadeStockLine = {
	claroCode: string
	name: string
	qty: number
	unit: string | null
}

/** `brigadeStockLines`, named from the catalog for display. */
export function brigadeStockTracked(
	fieldMaterials: unknown,
	codes: readonly {
		id: string
		claroCode: string
		name: string
		unit: string | null
	}[],
): BrigadeStockLine[] {
	const byId = new Map(codes.map((c) => [c.id, c]))
	return brigadeStockLines(fieldMaterials).map(({ serviceCodeId, qty }) => {
		const code = byId.get(serviceCodeId)
		return {
			claroCode: code?.claroCode ?? "",
			name: code?.name ?? serviceCodeId,
			qty,
			unit: code?.unit ?? null,
		}
	})
}

/** Whether a Field materials table was saved for the job. */
export function hasFieldTable(fieldMaterials: unknown): boolean {
	return storedRows(fieldMaterials).length > 0
}

/**
 * Brigade's-stock use, per code (used > 0), for the read-only "tracked, not
 * billed" list. Never part of a billable total.
 */
export function brigadeStockLines(fieldMaterials: unknown): MaterialLine[] {
	const byCode = new Map<string, number>()
	for (const r of storedRows(fieldMaterials)) {
		if (r.source !== "BRIGADE_STOCK" || r.used <= 0) continue
		byCode.set(r.serviceCodeId, (byCode.get(r.serviceCodeId) ?? 0) + r.used)
	}
	return [...byCode].map(([serviceCodeId, qty]) => ({ serviceCodeId, qty }))
}

function warehouseUsed(rows: FieldMaterialRow[]): Map<string, number> {
	const byCode = new Map<string, number>()
	for (const r of rows) {
		if (r.source !== "WAREHOUSE") continue
		byCode.set(r.serviceCodeId, (byCode.get(r.serviceCodeId) ?? 0) + r.used)
	}
	return byCode
}

/**
 * What was used out of the warehouse stock signed out at pickup, in the
 * `materialsUsed` shape: the WAREHOUSE rows of the Field table when there is
 * one. A Field save now writes exactly this to `materialsUsed`, but a row
 * saved before the brigade-stock ruling kept the WAREHOUSE + BRIGADE_STOCK
 * total there, so anything that compares or bills against the pickup (what
 * should come back, a quantity discrepancy, Finance's lines) reads this
 * instead. A job without a Field table (from before it) falls back to
 * `materialsUsed`.
 */
export function warehouseUsedLines(
	fieldMaterials: unknown,
	materialsUsed: unknown,
): MaterialLine[] {
	const rows = storedRows(fieldMaterials)
	if (rows.length === 0)
		return Array.isArray(materialsUsed) ? (materialsUsed as MaterialLine[]) : []
	return billableUsed(rows)
}

/**
 * Everything physically installed, both sources, in the `materialsUsed`
 * shape: what the variance view compares against the estimate. Not billable
 * (brigade's stock is in it). Falls back to `materialsUsed` without a table.
 */
export function installedLines(
	fieldMaterials: unknown,
	materialsUsed: unknown,
): MaterialLine[] {
	const rows = storedRows(fieldMaterials)
	if (rows.length === 0)
		return Array.isArray(materialsUsed) ? (materialsUsed as MaterialLine[]) : []
	const byCode = new Map<string, number>()
	for (const r of rows) {
		if (r.used <= 0) continue
		byCode.set(r.serviceCodeId, (byCode.get(r.serviceCodeId) ?? 0) + r.used)
	}
	return [...byCode].map(([serviceCodeId, qty]) => ({ serviceCodeId, qty }))
}

/**
 * Whether WAREHOUSE-source use of any code is above what was signed out at
 * pickup. Brigade's-stock rows were never signed out, so they never count.
 */
export function exceedsSigned(
	taken: MaterialLine[],
	rows: FieldMaterialRow[],
): boolean {
	const signed = new Map(taken.map((t) => [t.serviceCodeId, t.qty]))
	for (const [code, used] of warehouseUsed(rows)) {
		if (used > (signed.get(code) ?? 0)) return true
	}
	return false
}

/** Signed-out codes whose WAREHOUSE use differs from the signed quantity. */
export function quantityDiscrepancies(
	taken: MaterialLine[],
	rows: FieldMaterialRow[],
): { serviceCodeId: string; takenQty: number; usedQty: number }[] {
	const used = warehouseUsed(rows)
	const signed = new Map(taken.map((t) => [t.serviceCodeId, t.qty]))
	const codes = new Set([...signed.keys(), ...used.keys()])
	return [...codes]
		.map((serviceCodeId) => ({
			serviceCodeId,
			takenQty: signed.get(serviceCodeId) ?? 0,
			usedQty: used.get(serviceCodeId) ?? 0,
		}))
		.filter((d) => d.takenQty !== d.usedQty)
}

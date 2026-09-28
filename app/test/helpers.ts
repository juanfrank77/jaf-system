import { db } from "~/lib/db.server"

/**
 * Find-or-create a `ServiceCode` by its Claro code, returning the row.
 *
 * Warehouse rows key material by `serviceCodeId` (a `ServiceCode.id` cuid),
 * never a raw Claro string — so tests resolve a real row first and pass
 * `row.id`. `upsert` (rather than `create`) keeps the helper safe to call
 * from many server-test files sharing one `DATABASE_URL` without tripping
 * the `claroCode` unique constraint.
 */
export async function seedServiceCode(
	claroCode: string,
	overrides: {
		name?: string
		unitPrice?: number
		serialized?: boolean
		serialPrefix?: string | null
		reparadoCode?: string | null
		ownership?: "CLARO_CONSIGNED" | "JAF_PURCHASED" | "UNKNOWN"
	} = {},
) {
	return db.serviceCode.upsert({
		where: { claroCode },
		update: {},
		create: {
			claroCode,
			name: overrides.name ?? `Test ${claroCode}`,
			unitPrice: overrides.unitPrice ?? 0,
			serialized: overrides.serialized ?? false,
			serialPrefix: overrides.serialPrefix ?? null,
			reparadoCode: overrides.reparadoCode ?? null,
			ownership: overrides.ownership ?? "UNKNOWN",
		},
	})
}

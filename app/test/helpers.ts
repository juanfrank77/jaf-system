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

/** A unique token for a test file run — server tests share one (Neon dev) DB. */
export function runToken(prefix = "T") {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * Tracks rows created by a test file and deletes them in `afterAll`, so the
 * shared Neon dev database (also the demo DB) is not polluted with fixtures.
 * Deletion runs children → parents to respect FKs (StockMovement→Warehouse is
 * `onDelete: Restrict`; Notification→User is restricted too).
 */
export function makeTracker() {
	const b = {
		stockMovement: [] as string[],
		serialLocation: [] as string[],
		repairIntake: [] as string[],
		repairBatch: [] as string[],
		stockSnapshot: [] as string[],
		stockDelivery: [] as string[],
		notification: [] as string[],
		warehouseAssignment: [] as string[],
		warehouse: [] as string[],
		user: [] as string[],
		serviceCode: [] as string[],
	}
	function track<M extends keyof typeof b, R extends { id: string }>(
		model: M,
		row: R,
	): R {
		b[model].push(row.id)
		return row
	}
	async function cleanup() {
		// Tables with a warehouseId FK (onDelete: Restrict) are cleared by
		// warehouseId, not just tracked id — services create extra rows (e.g.
		// DISPOSITION movements) the test never sees, and any leftover would
		// block the warehouse delete.
		const whFilter = (idList: string[]) =>
			b.warehouse.length
				? { OR: [{ id: { in: idList } }, { warehouseId: { in: b.warehouse } }] }
				: { id: { in: idList } }
		if (b.stockMovement.length || b.warehouse.length)
			await db.stockMovement.deleteMany({ where: whFilter(b.stockMovement) })
		if (b.serialLocation.length)
			await db.serialLocation.deleteMany({
				where: { id: { in: b.serialLocation } },
			})
		if (b.repairIntake.length || b.warehouse.length)
			await db.repairIntake.deleteMany({ where: whFilter(b.repairIntake) })
		if (b.repairBatch.length || b.warehouse.length)
			await db.repairBatch.deleteMany({ where: whFilter(b.repairBatch) })
		if (b.stockSnapshot.length || b.warehouse.length)
			await db.stockSnapshot.deleteMany({ where: whFilter(b.stockSnapshot) })
		if (b.stockDelivery.length || b.warehouse.length)
			await db.stockDelivery.deleteMany({ where: whFilter(b.stockDelivery) })
		// Also remove service-created notifications addressed to tracked users.
		if (b.notification.length || b.user.length)
			await db.notification.deleteMany({
				where: {
					OR: [{ id: { in: b.notification } }, { userId: { in: b.user } }],
				},
			})
		if (b.warehouseAssignment.length)
			await db.warehouseAssignment.deleteMany({
				where: { id: { in: b.warehouseAssignment } },
			})
		if (b.warehouse.length)
			await db.warehouse.deleteMany({ where: { id: { in: b.warehouse } } })
		if (b.user.length)
			await db.user.deleteMany({ where: { id: { in: b.user } } })
		// serviceCodeId is a plain column (no DB FK), so ServiceCode rows can be
		// removed last, order-independent.
		if (b.serviceCode.length)
			await db.serviceCode.deleteMany({ where: { id: { in: b.serviceCode } } })
	}
	return { track, cleanup }
}

/** Create a fresh warehouse for a test (unique name). */
export async function seedWarehouse(name?: string) {
	return db.warehouse.create({
		data: { name: name ?? runToken("WH"), zone: "Z" },
	})
}

/** Create a user with a unique email. */
export async function seedUser(opts: { role?: string; name?: string } = {}) {
	return db.user.create({
		data: {
			email: `${runToken("u")}@x.test`,
			name: opts.name ?? "Test User",
			role: (opts.role ?? "WAREHOUSE") as
				| "WAREHOUSE"
				| "ADMIN"
				| "SUPERVISOR"
				| "CREW"
				| "FINANCE"
				| "COMPTROLLER"
				| "INSTALLER"
				| "INSTALLER_SUPERVISOR",
		},
	})
}

/**
 * Create/refresh a ServiceCode (material) with optional dual-UOM fields.
 * Defaults to a per-run-unique claroCode so tests never mutate a real catalog
 * row. Returns the row — key movements/serials by its `.id`, never the Claro
 * string.
 */
export async function seedMaterial(
	opts: {
		claroCode?: string
		name?: string
		unitPrice?: number
		countUnit?: string | null
		stockUnit?: string | null
		conversionFactor?: number | null
		serialized?: boolean
	} = {},
) {
	const claroCode = opts.claroCode ?? runToken("MAT")
	const fields = {
		name: opts.name ?? `Test ${claroCode}`,
		unitPrice: opts.unitPrice ?? 0,
		countUnit: opts.countUnit ?? null,
		stockUnit: opts.stockUnit ?? null,
		conversionFactor: opts.conversionFactor ?? null,
		serialized: opts.serialized ?? false,
	}
	return db.serviceCode.upsert({
		where: { claroCode },
		update: fields,
		create: { claroCode, ...fields },
	})
}

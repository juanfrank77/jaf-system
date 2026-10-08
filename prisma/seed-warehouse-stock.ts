import type { PrismaClient } from "../generated/prisma/client"

/**
 * Seed STARTING_BALANCE movements for each warehouse with a sample of materials.
 * Creates one flagged STARTING_BALANCE movement (kind=BULK) per (warehouse, sample material).
 * Idempotent: skips if any STARTING_BALANCE movement already exists.
 *
 * DEMO/DEV ONLY — requires SEED_DEMO_STOCK=1, same flag as the placeholder vans.
 * The quantities here are `Math.random()`, not a count: Orlando's maintenance
 * workbook (`LISTA DE MATERIALES PARA INVENTARIOS MANTENIMIENTO.xlsx`) lists 196
 * real materials with every quantity column empty, so there is no real opening
 * count to load yet. Seeding invented stock into a production warehouse would
 * write fabricated quantities into the append-only `stock_movement` ledger,
 * which Orlando would then have to count and adjust away. Real opening balances
 * arrive as counted quantities, not as a seed.
 */
export async function seedWarehouseStartingBalances(
	db: PrismaClient,
): Promise<void> {
	const note = "best effort, correct at first count"

	if (process.env.SEED_DEMO_STOCK !== "1") {
		// biome-ignore lint/suspicious/noConsole: seed output
		console.log(
			"starting balances: skipped (quantities are fabricated — set SEED_DEMO_STOCK=1 to seed demo stock)",
		)
		return
	}

	// Check if any STARTING_BALANCE movements already exist. Scoped to this
	// seeder's own note rather than to the whole type: a warehouse's real opening
	// balance would also be type STARTING_BALANCE, and an unscoped check would
	// make a demo re-seed silently skip because of it.
	const existing = await db.stockMovement.findFirst({
		where: { type: "STARTING_BALANCE", note: { contains: "best effort" } },
	})

	if (existing) {
		// biome-ignore lint/suspicious/noConsole: seed output
		console.log(
			"starting balances: skipped (already seeded; idempotent check passed)",
		)
		return
	}

	// Get all warehouses
	const warehouses = await db.warehouse.findMany({
		select: { id: true, name: true },
	})

	if (warehouses.length === 0) {
		// biome-ignore lint/suspicious/noConsole: seed output
		console.log("starting balances: skipped (no warehouses found)")
		return
	}

	// Get a sample of active materials (MATERIAL kind service codes)
	const materials = await db.serviceCode.findMany({
		where: { kind: "MATERIAL", active: true },
		select: { id: true, claroCode: true },
		orderBy: { claroCode: "asc" },
		take: 5, // Sample: up to 5 materials per warehouse
	})

	if (materials.length === 0) {
		// biome-ignore lint/suspicious/noConsole: seed output
		console.log("starting balances: skipped (no materials found)")
		return
	}

	// Get a warehouse lead to use as the creator
	const lead = await db.user.findFirst({
		where: { role: "WAREHOUSE" },
		select: { id: true },
	})

	if (!lead) {
		// biome-ignore lint/suspicious/noConsole: seed output
		console.log(
			"starting balances: skipped (no warehouse users found to attribute seed to)",
		)
		return
	}

	let created = 0

	for (const warehouse of warehouses) {
		for (const material of materials) {
			// Synthetic quantities: use a modest opening stock
			const qty = Math.floor(Math.random() * 50) + 10 // 10-60 units

			await db.stockMovement.create({
				data: {
					warehouseId: warehouse.id,
					kind: "BULK",
					serviceCodeId: material.id,
					qty,
					type: "STARTING_BALANCE",
					note,
					byUserId: lead.id,
				},
			})
			created++
		}
	}

	// biome-ignore lint/suspicious/noConsole: seed output
	console.log(
		`starting balances: ${created} movements seeded (${warehouses.length} warehouses × ${materials.length} materials)`,
	)
}

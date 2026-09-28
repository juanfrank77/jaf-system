import type { PrismaClient } from "../generated/prisma/client"

/**
 * Seed STARTING_BALANCE movements for each warehouse with a sample of materials.
 * Creates one flagged STARTING_BALANCE movement (kind=BULK) per (warehouse, sample material).
 * Idempotent: skips if any STARTING_BALANCE movement already exists.
 */
export async function seedWarehouseStartingBalances(
	db: PrismaClient,
): Promise<void> {
	// Check if any STARTING_BALANCE movements already exist
	const existing = await db.stockMovement.findFirst({
		where: { type: "STARTING_BALANCE" },
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
	const note = "best effort, correct at first count"

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

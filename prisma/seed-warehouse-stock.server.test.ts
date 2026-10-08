import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../app/lib/db.server"
import { seedWarehouseStartingBalances } from "./seed-warehouse-stock"

describe("seedWarehouseStartingBalances", { timeout: 60000 }, () => {
	// Only this seeder writes this note, and the server tests share one Neon
	// database that vitest runs in parallel. Cleanup is therefore scoped to it:
	// a blanket `deleteMany({ type: "STARTING_BALANCE" })` here deletes stock
	// fixtures belonging to warehouse-invariants / warehouse.stock while they
	// are mid-test, which shows up as failures in files that never touch the
	// seed.
	const fabricated = {
		where: { type: "STARTING_BALANCE", note: { contains: "best effort" } },
	} as const

	beforeAll(async () => {
		// The seeder is demo-only (fabricated quantities); the flag is what a
		// production `prisma db seed` deliberately does NOT set.
		process.env.SEED_DEMO_STOCK = "1"
		await db.stockMovement.deleteMany(fabricated)
	})

	afterAll(async () => {
		delete process.env.SEED_DEMO_STOCK
		await db.stockMovement.deleteMany(fabricated)
	})

	it("seeds flagged STARTING_BALANCE movements", async () => {
		await seedWarehouseStartingBalances(db)
		const moves = await db.stockMovement.findMany(fabricated)
		expect(moves.length).toBeGreaterThan(0)
		expect(moves.every((m) => m.kind === "BULK")).toBe(true)
	})

	it("is idempotent", async () => {
		// Note: first test already ran, so rows exist
		const countBefore = await db.stockMovement.count(fabricated)

		await seedWarehouseStartingBalances(db)

		expect(await db.stockMovement.count(fabricated)).toBe(countBefore)
	})

	it("writes nothing without SEED_DEMO_STOCK — a prod seed must not fabricate stock", async () => {
		const before = await db.stockMovement.count(fabricated)

		delete process.env.SEED_DEMO_STOCK
		await seedWarehouseStartingBalances(db)

		expect(await db.stockMovement.count(fabricated)).toBe(before)
	})
})

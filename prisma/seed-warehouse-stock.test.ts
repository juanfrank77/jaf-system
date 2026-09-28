import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "../app/lib/db.server"
import { seedWarehouseStartingBalances } from "./seed-warehouse-stock"

describe("seedWarehouseStartingBalances", { timeout: 60000 }, () => {
	beforeAll(async () => {
		// Clean up any existing STARTING_BALANCE movements before the test suite
		await db.stockMovement.deleteMany({
			where: { type: "STARTING_BALANCE" },
		})
	})

	afterAll(async () => {
		// Clean up after tests
		await db.stockMovement.deleteMany({
			where: { type: "STARTING_BALANCE" },
		})
	})

	it("seeds flagged STARTING_BALANCE movements", async () => {
		await seedWarehouseStartingBalances(db)
		const moves = await db.stockMovement.findMany({
			where: { type: "STARTING_BALANCE" },
		})
		expect(moves.length).toBeGreaterThan(0)
		expect(
			moves.every(
				(m) => m.kind === "BULK" && /best effort/i.test(m.note ?? ""),
			),
		).toBe(true)
	})

	it("is idempotent", async () => {
		// Note: first test already ran, so STARTING_BALANCE movements exist
		const countBefore = await db.stockMovement.count({
			where: { type: "STARTING_BALANCE" },
		})

		await seedWarehouseStartingBalances(db)

		const countAfter = await db.stockMovement.count({
			where: { type: "STARTING_BALANCE" },
		})

		expect(countBefore).toBe(countAfter)
	})
})

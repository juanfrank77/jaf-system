import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	computeParStatus,
	parLevelsToStockLevels,
	parseLegacyStockLevels,
	stockLevelsToLegacyJson,
} from "./van-stock"

vi.mock("./db.server", () => ({
	db: {
		vanStockLevel: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
		van: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
		},
		$transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
	},
}))

import { db } from "./db.server"
import {
	getVanParLevels,
	getVanParLevelsForVans,
	setVanParLevels,
} from "./van-stock.server"

describe("parseLegacyStockLevels", () => {
	it("parses a clean array of { serviceCodeId, qty }", () => {
		const result = parseLegacyStockLevels([
			{ serviceCodeId: "sc-1", qty: 5 },
			{ serviceCodeId: "sc-2", qty: 0 },
		])
		expect(result.levels).toEqual([
			{ serviceCodeId: "sc-1", parLevel: 5 },
			{ serviceCodeId: "sc-2", parLevel: 0 },
		])
		expect(result.skips).toHaveLength(0)
	})

	it("accepts numeric qty strings", () => {
		const result = parseLegacyStockLevels([{ serviceCodeId: "sc-1", qty: "3" }])
		expect(result.levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 3 }])
	})

	it("skips non-array JSON", () => {
		const result = parseLegacyStockLevels({ foo: 1 })
		expect(result.levels).toEqual([])
		expect(result.skips[0]?.reason).toBe("not_array")
	})

	it("accepts harmless extra fields on an entry", () => {
		const result = parseLegacyStockLevels([
			{ serviceCodeId: "sc-1", qty: 4, name: "Cable drop" },
		])
		expect(result.levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 4 }])
		expect(result.skips).toHaveLength(0)
	})

	it("skips entries with missing or invalid required fields", () => {
		const result = parseLegacyStockLevels([
			{ serviceCodeId: "", qty: 1 },
			{ serviceCodeId: "sc-2", qty: "nope" },
			{ qty: 1 },
		])
		expect(result.levels).toEqual([])
		expect(result.skips.map((s) => s.reason)).toEqual([
			"missing_service_code_id",
			"invalid_qty",
			"missing_service_code_id",
		])
	})

	it("skips duplicate serviceCodeId in one van", () => {
		const result = parseLegacyStockLevels([
			{ serviceCodeId: "sc-1", qty: 1 },
			{ serviceCodeId: "sc-1", qty: 2 },
		])
		expect(result.levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 1 }])
		expect(result.skips[0]?.reason).toBe("duplicate_service_code_id")
	})
})

describe("par level mappers", () => {
	it("round-trips to StockLevel and legacy JSON shapes", () => {
		const levels = [
			{ serviceCodeId: "sc-1", parLevel: 4 },
			{ serviceCodeId: "sc-2", parLevel: 0 },
		]
		expect(parLevelsToStockLevels(levels)).toEqual([
			{ serviceCodeId: "sc-1", qty: 4 },
			{ serviceCodeId: "sc-2", qty: 0 },
		])
		expect(stockLevelsToLegacyJson(levels)).toEqual([
			{ serviceCodeId: "sc-1", qty: 4 },
			{ serviceCodeId: "sc-2", qty: 0 },
		])
	})
})

describe("computeParStatus", () => {
	it("returns hasParLevels false when no par rows are configured", () => {
		const result = computeParStatus({
			parLevels: [],
			transactions: [{ serviceCodeId: "sc-1", qty: 10 }],
		})
		expect(result).toEqual({
			hasParLevels: false,
			belowParCount: 0,
			belowParLines: [],
		})
	})

	it("counts lines below par when par levels exist", () => {
		const result = computeParStatus({
			parLevels: [
				{ serviceCodeId: "sc-1", parLevel: 5 },
				{ serviceCodeId: "sc-2", parLevel: 3 },
			],
			transactions: [
				{ serviceCodeId: "sc-1", qty: 2 },
				{ serviceCodeId: "sc-2", qty: 3 },
			],
		})
		expect(result.hasParLevels).toBe(true)
		expect(result.belowParCount).toBe(1)
		expect(result.belowParLines[0]).toMatchObject({
			serviceCodeId: "sc-1",
			onHand: 2,
			parLevel: 5,
		})
	})

	it("returns belowParCount 0 when fully stocked at par", () => {
		const result = computeParStatus({
			parLevels: [{ serviceCodeId: "sc-1", parLevel: 5 }],
			transactions: [{ serviceCodeId: "sc-1", qty: 5 }],
		})
		expect(result.hasParLevels).toBe(true)
		expect(result.belowParCount).toBe(0)
		expect(result.belowParLines).toHaveLength(0)
	})
})

describe("getVanParLevels", () => {
	beforeEach(() => vi.clearAllMocks())

	it("reads from VanStockLevel when rows exist", async () => {
		vi.mocked(db.vanStockLevel.findMany).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		] as never)

		const levels = await getVanParLevels("van-1")
		expect(levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 5 }])
		expect(db.van.findUnique).not.toHaveBeenCalled()
	})

	it("falls back to legacy JSON when table is empty", async () => {
		vi.mocked(db.vanStockLevel.findMany).mockResolvedValue([])
		vi.mocked(db.van.findUnique).mockResolvedValue({
			standardStockLevels: [{ serviceCodeId: "sc-1", qty: 2 }],
		} as never)

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const levels = await getVanParLevels("van-1")
		expect(levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 2 }])
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("fallback_to_json"),
		)
		warn.mockRestore()
	})

	it("falls back to legacy JSON with extra fields on entries", async () => {
		vi.mocked(db.vanStockLevel.findMany).mockResolvedValue([])
		vi.mocked(db.van.findUnique).mockResolvedValue({
			standardStockLevels: [
				{ serviceCodeId: "sc-1", qty: 2, name: "Cable drop" },
			],
		} as never)

		const levels = await getVanParLevels("van-1")
		expect(levels).toEqual([{ serviceCodeId: "sc-1", parLevel: 2 }])
	})
})

describe("setVanParLevels", () => {
	beforeEach(() => vi.clearAllMocks())

	it("preserves inactive rows on update", async () => {
		vi.mocked(db.vanStockLevel.findMany).mockResolvedValue([
			{ serviceCodeId: "inactive-code", parLevel: 4 },
		] as never)
		vi.mocked(db.vanStockLevel.upsert).mockResolvedValue({} as never)
		vi.mocked(db.van.update).mockResolvedValue({} as never)

		const merged = await setVanParLevels(
			"van-1",
			[{ serviceCodeId: "active-code", parLevel: 3 }],
			"update",
		)

		expect(merged).toEqual(
			expect.arrayContaining([
				{ serviceCodeId: "inactive-code", parLevel: 4 },
				{ serviceCodeId: "active-code", parLevel: 3 },
			]),
		)
		expect(db.van.update).toHaveBeenCalledWith({
			where: { id: "van-1" },
			data: {
				standardStockLevels: stockLevelsToLegacyJson(merged),
			},
		})
	})
})

describe("getVanParLevelsForVans", () => {
	beforeEach(() => vi.clearAllMocks())

	it("batch-loads table rows and falls back per van", async () => {
		vi.mocked(db.vanStockLevel.findMany).mockResolvedValue([
			{ vanId: "van-a", serviceCodeId: "sc-1", parLevel: 1 },
		] as never)
		vi.mocked(db.van.findMany).mockResolvedValue([
			{
				id: "van-b",
				standardStockLevels: [{ serviceCodeId: "sc-2", qty: 2 }],
			},
		] as never)

		const map = await getVanParLevelsForVans(["van-a", "van-b"])
		expect(map.get("van-a")).toEqual([{ serviceCodeId: "sc-1", parLevel: 1 }])
		expect(map.get("van-b")).toEqual([{ serviceCodeId: "sc-2", parLevel: 2 }])
	})
})

import { describe, expect, it } from "vitest"
import {
	billableUsed,
	brigadeStockLines,
	brigadeStockTracked,
	exceedsSigned,
	type FieldMaterialRow,
	fieldMaterialsOrDefault,
	packetMaterialRows,
	parseFieldMaterials,
	warehouseUsedLines,
} from "./field-materials"

const row = (
	serviceCodeId: string,
	used: number,
	source: FieldMaterialRow["source"] = "WAREHOUSE",
	returned = 0,
): FieldMaterialRow => ({ serviceCodeId, used, returned, source })

describe("parseFieldMaterials", () => {
	it("returns no rows for null or empty input", () => {
		expect(parseFieldMaterials(null)).toEqual([])
		expect(parseFieldMaterials("")).toEqual([])
	})

	it("reads rows, coercing numbers and defaulting a missing source to WAREHOUSE", () => {
		expect(
			parseFieldMaterials(
				JSON.stringify([
					{ serviceCodeId: "sc-1", used: "3", returned: 2 },
					{ serviceCodeId: "sc-2", used: 1, source: "BRIGADE_STOCK" },
				]),
			),
		).toEqual([
			row("sc-1", 3, "WAREHOUSE", 2),
			row("sc-2", 1, "BRIGADE_STOCK", 0),
		])
	})

	it("skips rows with no service code", () => {
		expect(
			parseFieldMaterials(JSON.stringify([{ serviceCodeId: "", used: 1 }])),
		).toEqual([])
	})

	it("throws on malformed JSON, a non-array, a negative quantity or an unknown source", () => {
		expect(() => parseFieldMaterials("{bad")).toThrow()
		expect(() => parseFieldMaterials("{}")).toThrow()
		expect(() =>
			parseFieldMaterials(JSON.stringify([{ serviceCodeId: "a", used: -1 }])),
		).toThrow()
		expect(() =>
			parseFieldMaterials(
				JSON.stringify([{ serviceCodeId: "a", used: 1, source: "VAN" }]),
			),
		).toThrow()
	})
})

describe("billableUsed", () => {
	it("keeps WAREHOUSE rows with used > 0 as {serviceCodeId, qty}, summed per code", () => {
		expect(
			billableUsed([
				row("sc-1", 3),
				row("sc-2", 0),
				row("sc-1", 2),
				row("sc-4", 1),
			]),
		).toEqual([
			{ serviceCodeId: "sc-1", qty: 5 },
			{ serviceCodeId: "sc-4", qty: 1 },
		])
	})

	it("keeps brigade's own stock off the billable lines", () => {
		// 6 from the warehouse pickup, 4 from the brigade's stock: bill 6.
		expect(
			billableUsed([
				row("sc-1", 6),
				row("sc-1", 4, "BRIGADE_STOCK"),
				row("sc-3", 1, "BRIGADE_STOCK"),
			]),
		).toEqual([{ serviceCodeId: "sc-1", qty: 6 }])
	})
})

describe("brigadeStockTracked", () => {
	it("names BRIGADE_STOCK rows from the catalog, never WAREHOUSE ones", () => {
		const codes = [
			{ id: "sc-1", claroCode: "1005803", name: "Drop cable", unit: "FT" },
			{ id: "sc-2", claroCode: "1005900", name: "Clamp", unit: null },
		]
		expect(
			brigadeStockTracked(
				[row("sc-1", 6), row("sc-1", 4, "BRIGADE_STOCK"), row("sc-2", 2)],
				codes,
			),
		).toEqual([
			{
				serviceCodeId: "sc-1",
				claroCode: "1005803",
				name: "Drop cable",
				qty: 4,
				unit: "FT",
			},
		])
		expect(brigadeStockTracked([row("sc-1", 6)], codes)).toEqual([])
	})

	it("falls back to the id when the code is not in the catalog", () => {
		expect(brigadeStockTracked([row("sc-9", 1, "BRIGADE_STOCK")], [])).toEqual([
			{
				serviceCodeId: "sc-9",
				claroCode: "",
				name: "sc-9",
				qty: 1,
				unit: null,
			},
		])
	})
})

describe("brigadeStockLines", () => {
	it("lists BRIGADE_STOCK use > 0 per code, ignoring WAREHOUSE rows", () => {
		expect(
			brigadeStockLines([
				row("sc-1", 6),
				row("sc-1", 4, "BRIGADE_STOCK"),
				row("sc-2", 0, "BRIGADE_STOCK"),
				row("sc-3", 1, "BRIGADE_STOCK"),
				row("sc-3", 2, "BRIGADE_STOCK"),
			]),
		).toEqual([
			{ serviceCodeId: "sc-1", qty: 4 },
			{ serviceCodeId: "sc-3", qty: 3 },
		])
	})

	it("is empty for a legacy job or unreadable data", () => {
		expect(brigadeStockLines(null)).toEqual([])
		expect(brigadeStockLines([])).toEqual([])
		expect(brigadeStockLines("nope")).toEqual([])
		expect(brigadeStockLines([row("sc-1", 5)])).toEqual([])
	})
})

describe("exceedsSigned", () => {
	const taken = [{ serviceCodeId: "sc-1", qty: 5 }]

	it("is false when WAREHOUSE use is within what was signed out", () => {
		expect(exceedsSigned(taken, [row("sc-1", 5)])).toBe(false)
	})

	it("is true when WAREHOUSE use is above what was signed out", () => {
		expect(exceedsSigned(taken, [row("sc-1", 6)])).toBe(true)
	})

	it("is true for a WAREHOUSE code that was never signed out", () => {
		expect(exceedsSigned(taken, [row("sc-9", 1)])).toBe(true)
	})

	it("ignores BRIGADE_STOCK rows", () => {
		expect(
			exceedsSigned(taken, [
				row("sc-1", 5),
				row("sc-1", 10, "BRIGADE_STOCK"),
				row("sc-9", 4, "BRIGADE_STOCK"),
			]),
		).toBe(false)
	})
})

describe("packetMaterialRows", () => {
	it("keeps WAREHOUSE rows only (brigade's stock is never on the packet)", () => {
		expect(
			packetMaterialRows(
				[row("sc-1", 6, "WAREHOUSE", 4), row("sc-2", 4, "BRIGADE_STOCK")],
				[],
			),
		).toEqual([row("sc-1", 6, "WAREHOUSE", 4)])
	})

	it("defaults to the pickup when nothing is stored", () => {
		expect(
			packetMaterialRows(null, [{ serviceCodeId: "sc-1", qty: 5 }]),
		).toEqual([row("sc-1", 5)])
	})
})

describe("fieldMaterialsOrDefault", () => {
	const taken = [{ serviceCodeId: "sc-1", qty: 5 }]

	it("builds WAREHOUSE rows from what was signed out when nothing is stored", () => {
		expect(fieldMaterialsOrDefault(null, taken)).toEqual([row("sc-1", 5)])
		expect(fieldMaterialsOrDefault([], taken)).toEqual([row("sc-1", 5)])
	})

	it("returns the stored rows when there are any", () => {
		const stored = [row("sc-1", 2, "WAREHOUSE", 3)]
		expect(fieldMaterialsOrDefault(stored, taken)).toEqual(stored)
	})
})

describe("warehouseUsedLines", () => {
	it("counts only WAREHOUSE-source use when the Field table exists", () => {
		const rows = [
			{ serviceCodeId: "m1", used: 6, returned: 0, source: "WAREHOUSE" },
			{ serviceCodeId: "m1", used: 4, returned: 0, source: "BRIGADE_STOCK" },
			{ serviceCodeId: "m2", used: 3, returned: 0, source: "BRIGADE_STOCK" },
		]
		// A row saved before the brigade-stock ruling kept the total (10) in
		// materialsUsed; returns still see 6.
		expect(
			warehouseUsedLines(rows, [{ serviceCodeId: "m1", qty: 10 }]),
		).toEqual([{ serviceCodeId: "m1", qty: 6 }])
	})

	it("matches materialsUsed for a row saved under the ruling (WAREHOUSE only)", () => {
		const rows = [
			{ serviceCodeId: "m1", used: 6, returned: 0, source: "WAREHOUSE" },
			{ serviceCodeId: "m1", used: 4, returned: 0, source: "BRIGADE_STOCK" },
		]
		expect(warehouseUsedLines(rows, [{ serviceCodeId: "m1", qty: 6 }])).toEqual(
			[{ serviceCodeId: "m1", qty: 6 }],
		)
	})

	it("falls back to materialsUsed on a legacy job with no Field table", () => {
		const used = [{ serviceCodeId: "m1", qty: 7 }]
		expect(warehouseUsedLines(null, used)).toEqual(used)
		expect(warehouseUsedLines([], used)).toEqual(used)
		expect(warehouseUsedLines(null, null)).toEqual([])
	})
})

describe("no used-vs-issued comparison", () => {
	it("no longer exports quantityDiscrepancies", async () => {
		const mod = await import("./field-materials")
		expect("quantityDiscrepancies" in mod).toBe(false)
	})
})

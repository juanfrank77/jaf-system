import { describe, expect, it } from "vitest"
import {
	exceedsSigned,
	type FieldMaterialRow,
	fieldMaterialsOrDefault,
	parseFieldMaterials,
	quantityDiscrepancies,
	usedForFinance,
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

describe("usedForFinance", () => {
	it("keeps rows with used > 0 as {serviceCodeId, qty}, summing a code across sources", () => {
		expect(
			usedForFinance([
				row("sc-1", 3),
				row("sc-2", 0),
				row("sc-1", 2, "BRIGADE_STOCK"),
				row("sc-3", 1, "BRIGADE_STOCK"),
			]),
		).toEqual([
			{ serviceCodeId: "sc-1", qty: 5 },
			{ serviceCodeId: "sc-3", qty: 1 },
		])
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

describe("quantityDiscrepancies", () => {
	it("lists WAREHOUSE codes whose used differs from signed out", () => {
		expect(
			quantityDiscrepancies(
				[
					{ serviceCodeId: "sc-1", qty: 5 },
					{ serviceCodeId: "sc-2", qty: 2 },
				],
				[row("sc-1", 3), row("sc-2", 2), row("sc-3", 1, "BRIGADE_STOCK")],
			),
		).toEqual([{ serviceCodeId: "sc-1", takenQty: 5, usedQty: 3 }])
	})

	it("counts a signed-out code with no row as zero used", () => {
		expect(
			quantityDiscrepancies([{ serviceCodeId: "sc-1", qty: 5 }], []),
		).toEqual([{ serviceCodeId: "sc-1", takenQty: 5, usedQty: 0 }])
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
		// materialsUsed keeps the total (10) for Finance; returns see 6.
		expect(
			warehouseUsedLines(rows, [{ serviceCodeId: "m1", qty: 10 }]),
		).toEqual([{ serviceCodeId: "m1", qty: 6 }])
	})

	it("falls back to materialsUsed on a legacy job with no Field table", () => {
		const used = [{ serviceCodeId: "m1", qty: 7 }]
		expect(warehouseUsedLines(null, used)).toEqual(used)
		expect(warehouseUsedLines([], used)).toEqual(used)
		expect(warehouseUsedLines(null, null)).toEqual([])
	})
})

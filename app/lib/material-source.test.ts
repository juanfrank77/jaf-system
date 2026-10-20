import { describe, expect, it } from "vitest"
import {
	isBillableSource,
	MATERIAL_SOURCES,
	normaliseSource,
	sourceLabelKey,
} from "./material-source"

describe("normaliseSource", () => {
	it("maps the legacy values", () => {
		expect(normaliseSource("WAREHOUSE")).toBe("WAREHOUSE_ISSUE")
		expect(normaliseSource("BRIGADE_STOCK")).toBe("TRUCK_STOCK")
	})
	it("keeps every valid new value", () => {
		for (const s of MATERIAL_SOURCES) expect(normaliseSource(s)).toBe(s)
	})
	it("defaults anything else to WAREHOUSE_ISSUE", () => {
		expect(normaliseSource(undefined)).toBe("WAREHOUSE_ISSUE")
		expect(normaliseSource(null)).toBe("WAREHOUSE_ISSUE")
		expect(normaliseSource("FOO")).toBe("WAREHOUSE_ISSUE")
		expect(normaliseSource(3)).toBe("WAREHOUSE_ISSUE")
	})
})

describe("isBillableSource", () => {
	it("is true only for WAREHOUSE_ISSUE", () => {
		expect(MATERIAL_SOURCES.filter(isBillableSource)).toEqual([
			"WAREHOUSE_ISSUE",
		])
	})
})

describe("sourceLabelKey", () => {
	it("gives each source its own label key", () => {
		expect(new Set(MATERIAL_SOURCES.map(sourceLabelKey)).size).toBe(5)
	})
})

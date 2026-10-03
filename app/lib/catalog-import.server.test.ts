import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	BRIGADE_SEED,
	parseCatalogCsv,
	SUPERVISOR_SEED,
	toServiceCodeData,
} from "./catalog-import"

const csvPath = path.resolve(
	__dirname,
	"../../docs/JAF_Service_Catalog_seed.csv",
)

describe("parseCatalogCsv", () => {
	const rows = parseCatalogCsv(fs.readFileSync(csvPath, "utf8"))

	it("reads all 934 rows with unique codes", () => {
		expect(rows).toHaveLength(934)
		expect(new Set(rows.map((r) => r.service_code)).size).toBe(934)
	})

	it("maps a full row", () => {
		const row = rows.find((r) => r.service_code === "34006301")
		expect(row).toBeDefined()
		const data = toServiceCodeData(row!)
		expect(data).toEqual({
			claroCode: "34006301",
			name: "TRANSFER ATTCH DE POSTESMC",
			kind: "SERVICE",
			unit: "EA",
			unitPrice: "42.3430",
			claroBasePrice: "36.8200",
			upliftFactor: "1.15",
			contractorPrice: "27.5230",
			contractorFactor: "0.65",
			priceListRevision: "REV 2023-04-21",
			effectiveFrom: new Date("2023-04-21T00:00:00.000Z"),
			accountCode: "610",
			active: true,
		})
	})

	it("turns blank account and uplift into null; blank unit becomes empty string (unit is NOT NULL in production)", () => {
		const blankUnit = rows.find((r) => r.unit === "")
		expect(toServiceCodeData(blankUnit!).unit).toBe("")
		const blankAccount = rows.find((r) => r.account_code === "")
		expect(toServiceCodeData(blankAccount!).accountCode).toBeNull()
		const blankUplift = rows.find((r) => r.uplift_factor === "")
		expect(toServiceCodeData(blankUplift!).upliftFactor).toBeNull()
	})
})

describe("seed constants", () => {
	it("has 4 supervisors and 14 brigades, 14 with codes", () => {
		expect(SUPERVISOR_SEED).toHaveLength(4)
		expect(BRIGADE_SEED).toHaveLength(14)
		expect(BRIGADE_SEED.filter((b) => b.code).length).toBe(14)
		expect(BRIGADE_SEED.find((b) => b.name === "JESUS MARTINEZ")?.code).toBe(
			"204",
		)
		expect(BRIGADE_SEED.find((b) => b.name === "ZARIEL SIERRA")?.code).toBe(
			"274",
		)
		for (const b of BRIGADE_SEED) {
			expect(SUPERVISOR_SEED.map((s) => s.email)).toContain(b.supervisorEmail)
		}
	})
})

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	BRIGADE_SEED,
	parseCatalogCsv,
	SUPERVISOR_SEED,
	toServiceCodeData,
	WAREHOUSE_BACKUP_SEED,
	WAREHOUSE_STAFF_SEED,
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
			act: "M",
			active: true,
		})
	})

	it("carries A/C and ACT for every line of sample M17-10353721", () => {
		const sample: Record<string, [string, string]> = {
			"34007030": ["610", "2"],
			"34006293": ["600", "X"],
			"34007048": ["630", "2"],
			"34007032": ["610", "2"],
			"34006425": ["610", "X"],
			"34006427": ["610", "X"],
			"34006291": ["600", "X"],
			"34005457": ["600", "C"],
			"34006301": ["610", "M"],
			"34006428": ["610", "X"],
			"34005497": ["610", "C"],
		}
		for (const [code, [ac, act]] of Object.entries(sample)) {
			const data = toServiceCodeData(rows.find((r) => r.service_code === code)!)
			expect(data.accountCode?.slice(0, 3)).toBe(ac)
			expect(data.act).toBe(act)
		}
	})

	it("every code has an A/C and an ACT, including the 12 whose price-list text has a prefix", () => {
		for (const r of rows) {
			expect(r.account_code, r.service_code).toMatch(/^6\d{2,3}$/)
			expect(r.act, r.service_code).toMatch(/^[0-9A-Z]$/)
		}
	})

	it("turns blank account and uplift into null; blank unit becomes empty string (unit is NOT NULL in production)", () => {
		const blankUnit = rows.find((r) => r.unit === "")
		expect(toServiceCodeData(blankUnit!).unit).toBe("")
		const blankAccount = { ...rows[0], account_code: "" }
		expect(toServiceCodeData(blankAccount).accountCode).toBeNull()
		const blankUplift = rows.find((r) => r.uplift_factor === "")
		expect(toServiceCodeData(blankUplift!).upliftFactor).toBeNull()
	})
})

describe("seed constants", () => {
	it("has 4 supervisors and 15 brigades, 11 with confirmed numbers", () => {
		expect(SUPERVISOR_SEED).toHaveLength(4)
		expect(BRIGADE_SEED).toHaveLength(15)
		expect(BRIGADE_SEED.filter((b) => b.code)).toHaveLength(11)
		const code = (name: string) =>
			BRIGADE_SEED.find((b) => b.name === name)?.code
		// q&a 14.1: the numbers printed on the paper Production Journal, paired
		// with the full name the journal prints — not Carmen's registry, which
		// disagrees on nearly every brigade.
		expect(code("JESUS MARTINEZ")).toBe("009")
		expect(code("ALEXIS DIAZ")).toBe("025")
		expect(code("ZARIEL GARAY SIERRA")).toBe("178")
		expect(code("JOSE A RIOS RIVERA")).toBe("141")
		expect(code("JUAN GARCIA PEREZ")).toBe("019")
		expect(code("ANGEL D JIMENEZ")).toBe("124")
		expect(code("MIGUEL PEREZ VARGAS")).toBe("176")
		// Active brigades whose number is not confirmed yet. Carmen's registry has
		// 209/261/256 for three of them, but nothing confirms them.
		for (const name of [
			"DINO CASTILLO",
			"SAMUEL GONZALEZ",
			"CARLOS RODRIGUEZ",
			"IR COMMUNICATION & CONSTRUCTION",
		])
			expect(code(name)).toBeNull()
	})

	it("brigade codes are unique, and only José Ríos is inactive", () => {
		const codes = BRIGADE_SEED.map((b) => b.code).filter(Boolean)
		expect(new Set(codes).size).toBe(codes.length)
		expect(
			BRIGADE_SEED.filter((b) => b.active === false).map((b) => b.name),
		).toEqual(["JOSE A RIOS RIVERA"])
	})

	it("every brigade with a supervisor points at a seeded supervisor", () => {
		for (const b of BRIGADE_SEED.filter((b) => b.supervisorEmail)) {
			expect(SUPERVISOR_SEED.map((s) => s.email)).toContain(b.supervisorEmail)
		}
	})

	it("uses routable jafcom.net addresses for every seeded login", () => {
		// `.local` can never receive mail, so a password reset for a `.local`
		// account is undeliverable and the account is locked out for good. Every
		// seeded address must be on the real domain.
		const addresses = [
			...SUPERVISOR_SEED.map((s) => s.email),
			...WAREHOUSE_STAFF_SEED.map((s) => s.email),
			...WAREHOUSE_BACKUP_SEED.map((s) => s.email),
		]
		for (const email of addresses) expect(email).toMatch(/@jafcom\.net$/)
	})
})

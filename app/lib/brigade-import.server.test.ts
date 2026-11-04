import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { BrigadeImportError, parseBrigadeImportFile } from "./brigade-import"

const sample = () =>
	new Uint8Array(readFileSync("docs/JAF_Brigades_Import_179.csv"))

const xlsx = async (rows: (string | number)[][]) => {
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Brigades")
	for (const r of rows) ws.addRow(r)
	return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)
}

const header = [
	"code",
	"name",
	"base_code",
	"is_equipment_account",
	"status",
	"type_hint",
	"check_with_lissette",
]

describe("parseBrigadeImportFile (csv)", () => {
	it("reads the 179-row sample with codes verbatim and BOM stripped", async () => {
		const rows = await parseBrigadeImportFile(
			"JAF_Brigades_Import_179.csv",
			sample(),
		)
		expect(rows).toHaveLength(179)
		expect(rows.filter((r) => r.isEquipmentAccount)).toHaveLength(24)
		const text = readFileSync("docs/JAF_Brigades_Import_179.csv", "utf8")
		const codes = text
			.replace(/^﻿/, "")
			.split(/\r?\n/)
			.slice(1)
			.filter(Boolean)
			.map((l) => l.split(",")[0])
		expect(rows.map((r) => r.code)).toEqual(codes)
		expect(rows.some((r) => r.code === "126D")).toBe(true)
		expect(rows.some((r) => /^0\d\d$/.test(r.code))).toBe(true)
		expect(rows[1]).toMatchObject({
			code: "126D",
			baseCode: "126",
			isEquipmentAccount: true,
			status: "INACTIVE",
		})
		expect(rows[0].baseCode).toBeNull()
	})

	it("throws on an empty file and on a missing required column", async () => {
		const enc = (s: string) => new TextEncoder().encode(s)
		await expect(
			parseBrigadeImportFile("a.csv", enc("")),
		).rejects.toBeInstanceOf(BrigadeImportError)
		await expect(
			parseBrigadeImportFile("a.csv", enc("code,name\n")),
		).rejects.toMatchObject({ key: "comptroller_brigades.errors.import_empty" })
		await expect(
			parseBrigadeImportFile("a.csv", enc("name,status\nX,ACTIVE\n")),
		).rejects.toMatchObject({
			key: "comptroller_brigades.errors.import_missing_column",
		})
	})

	it("accepts yes/no/true/false, case-insensitive headers, drops blank rows", async () => {
		const csv =
			"CODE,Name,Is_Equipment_Account\n1,A,TRUE\n2,B,No\n,C,yes\n3,,yes\n"
		const rows = await parseBrigadeImportFile(
			"x.CSV",
			new TextEncoder().encode(csv),
		)
		expect(rows.map((r) => [r.code, r.isEquipmentAccount])).toEqual([
			["1", true],
			["2", false],
		])
		expect(rows[0].status).toBe("ACTIVE")
	})
})

describe("parseBrigadeImportFile (xlsx)", () => {
	it("keeps text codes and flags short numeric codes", async () => {
		const data = await xlsx([
			header,
			[25, "NUM", "", "no", "ACTIVE", "", ""],
			["025", "TXT", "", "no", "ACTIVE", "", ""],
			["126D", "EQ", "126", "yes", "INACTIVE", "", ""],
			[1234, "LONG", "", "no", "weird", "", ""],
		])
		const rows = await parseBrigadeImportFile("b.xlsx", data)
		expect(rows.map((r) => r.code)).toEqual(["25", "025", "126D", "1234"])
		expect(rows[0].warning).toBe("numeric_code")
		expect(rows[1].warning).toBeUndefined()
		expect(rows[3].warning).toBeUndefined()
		expect(rows[2]).toMatchObject({ baseCode: "126", isEquipmentAccount: true })
		expect(rows[3].status).toBe("INACTIVE")
	})

	it("throws on an xlsx with no data rows", async () => {
		await expect(
			parseBrigadeImportFile("b.xlsx", await xlsx([header])),
		).rejects.toBeInstanceOf(BrigadeImportError)
	})
})

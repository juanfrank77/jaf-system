import ExcelJS from "exceljs"
import { splitCsvLine } from "./catalog-import"

export type BrigadeImportRow = {
	code: string
	name: string
	baseCode: string | null
	isEquipmentAccount: boolean
	status: "ACTIVE" | "INACTIVE"
	typeHint: string | null
	checkWithLissette: string | null
	/** A numeric xlsx code cell shorter than 3 chars may have lost leading zeros. */
	warning?: "numeric_code"
}

export class BrigadeImportError extends Error {
	constructor(public key: string) {
		super(key)
		this.name = "BrigadeImportError"
	}
}

const REQUIRED = ["code", "name"] as const

type RawRow = { cells: string[]; numericCode: boolean }

const emptyToNull = (s: string | undefined) => (s ? s : null)

const parseCsv = (data: Uint8Array): string[][] => {
	const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "")
	return text
		.split(/\r?\n/)
		.filter((l) => l.trim() !== "")
		.map(splitCsvLine)
}

const parseXlsx = async (
	data: Uint8Array,
): Promise<{ grid: string[][]; numeric: boolean[][] }> => {
	const wb = new ExcelJS.Workbook()
	await wb.xlsx.load(data as unknown as ExcelJS.Buffer)
	const ws = wb.worksheets[0]
	const grid: string[][] = []
	const numeric: boolean[][] = []
	if (!ws) return { grid, numeric }
	const width = ws.columnCount
	ws.eachRow({ includeEmpty: false }, (row) => {
		const cells: string[] = []
		const nums: boolean[] = []
		for (let c = 1; c <= width; c++) {
			const cell = row.getCell(c)
			cells.push((cell.text ?? "").trim())
			nums.push(typeof cell.value === "number")
		}
		grid.push(cells)
		numeric.push(nums)
	})
	return { grid, numeric }
}

const parseBool = (s: string) =>
	["yes", "true", "y", "1", "si", "sí"].includes(s.toLowerCase())

/** Blank means ACTIVE; any unrecognised value is treated as INACTIVE. */
const parseStatus = (s: string): "ACTIVE" | "INACTIVE" =>
	s === "" || s.toUpperCase() === "ACTIVE" ? "ACTIVE" : "INACTIVE"

export async function parseBrigadeImportFile(
	name: string,
	data: Uint8Array,
): Promise<BrigadeImportRow[]> {
	const isXlsx = name.toLowerCase().endsWith(".xlsx")
	let grid: string[][]
	let numeric: boolean[][] = []
	if (isXlsx) {
		;({ grid, numeric } = await parseXlsx(data))
	} else {
		grid = parseCsv(data)
	}
	if (grid.length === 0) {
		throw new BrigadeImportError("comptroller_brigades.errors.import_empty")
	}

	const header = grid[0].map((h) => h.trim().toLowerCase())
	const idx = (col: string) => header.indexOf(col)
	for (const col of REQUIRED) {
		if (idx(col) === -1) {
			throw new BrigadeImportError(
				"comptroller_brigades.errors.import_missing_column",
			)
		}
	}
	const iCode = idx("code")
	const iName = idx("name")
	const iBase = idx("base_code")
	const iEquip = idx("is_equipment_account")
	const iStatus = idx("status")
	const iHint = idx("type_hint")
	const iCheck = idx("check_with_lissette")

	const raw: RawRow[] = grid.slice(1).map((cells, r) => ({
		cells: cells.map((c) => c.trim()),
		numericCode: numeric[r + 1]?.[iCode] ?? false,
	}))
	const get = (cells: string[], i: number) => (i === -1 ? "" : (cells[i] ?? ""))

	const rows: BrigadeImportRow[] = []
	for (const { cells, numericCode } of raw) {
		const code = get(cells, iCode)
		const rowName = get(cells, iName)
		if (!code || !rowName) continue
		const row: BrigadeImportRow = {
			code,
			name: rowName,
			baseCode: emptyToNull(get(cells, iBase)),
			isEquipmentAccount: parseBool(get(cells, iEquip)),
			status: parseStatus(get(cells, iStatus)),
			typeHint: emptyToNull(get(cells, iHint)),
			checkWithLissette: emptyToNull(get(cells, iCheck)),
		}
		if (numericCode && code.length < 3) row.warning = "numeric_code"
		rows.push(row)
	}
	if (rows.length === 0) {
		throw new BrigadeImportError("comptroller_brigades.errors.import_empty")
	}
	return rows
}

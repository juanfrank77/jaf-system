import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { summarizeAviso } from "./aviso-summary"
import { generateLedgerXlsx, MISSING, missingFlags } from "./ledger-xlsx.server"

const d = (s: string) => new Date(`${s}T12:00:00Z`)
const sum = (over: object = {}) =>
	summarizeAviso(
		{
			id: "a",
			avisoNumber: "10351234",
			controlNumber: "JAF-1",
			address: "Calle 1",
			supervisor: "E. Ocasio",
			brigades: ["204 Norte"],
			zone: null,
			jobCompletedAt: d("2026-05-01"),
			lines: [{ qty: 1, unitPrice: 100 }],
			releasedAt: d("2026-05-02"),
			acceptedAt: null, // missing although it was sold
			soldAt: d("2026-05-06"),
			batchNumber: 2,
			payrollRequestAt: null,
			brigadePaidAt: null,
			armBClosedAt: null,
			pos: [],
			...over,
		},
		d("2026-10-30"),
	)

describe("missingFlags", () => {
	it("marks a date missing only when a later one exists", () => {
		const D = (at: string | null) => ({
			at,
			source: at ? ("STAMPED" as const) : null,
		})
		expect(missingFlags([D("a"), D(null), D("c"), D(null)])).toEqual([
			false,
			true,
			false,
			false,
		])
	})
})

describe("generateLedgerXlsx", () => {
	it("writes one row per Aviso, real dates, money formats, and MISSING in red", async () => {
		const buf = await generateLedgerXlsx([
			sum(),
			sum({ avisoNumber: "10351235" }),
		])
		const wb = new ExcelJS.Workbook()
		await wb.xlsx.load(buf as never)
		const ws = wb.getWorksheet("Ledger")
		expect(ws?.rowCount).toBe(3)
		const header = ws?.getRow(1).values as string[]
		const col = (name: string) => header.indexOf(name)
		const row = ws?.getRow(2)
		expect(row?.getCell(col("Aviso #")).value).toBe("10351234")
		expect(row?.getCell(col("Total")).value).toBe(111.5)
		expect(row?.getCell(col("Total")).numFmt).toBe("#,##0.00")
		expect(row?.getCell(col("Sold to PBCC")).value).toBeInstanceOf(Date)
		const accepted = row?.getCell(col("Accepted"))
		expect(accepted?.value).toBe(MISSING)
		expect((accepted?.font?.color as { argb: string }).argb).toBe("FFCC0000")
		// Not yet happened: blank, not MISSING.
		expect(row?.getCell(col("Brigade paid")).value ?? null).toBeNull()
	})

	it("repeats the PO columns for the Aviso with the most POs", async () => {
		const po = (n: string) => ({
			poId: n,
			poNumber: n,
			poDate: d("2026-06-20"),
			poSubtotal: 50,
			poTotal: 55.75,
			poConfirmedAt: d("2026-06-20"),
			termsDays: 60,
			invoice: null,
		})
		const buf = await generateLedgerXlsx([sum({ pos: [po("P1"), po("P2")] })])
		const wb = new ExcelJS.Workbook()
		await wb.xlsx.load(buf as never)
		const header = wb.getWorksheet("Ledger")?.getRow(1).values as string[]
		expect(header).toContain("PO # 1")
		expect(header).toContain("PO # 2")
	})
})

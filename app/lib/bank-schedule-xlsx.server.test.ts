import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import {
	generateScheduleXlsx,
	puertoRicoCalendarDate,
	type ScheduleInput,
} from "./bank-schedule-xlsx.server"

const base: ScheduleInput = {
	rows: [
		{
			invoiceDate: new Date("2026-08-17"),
			invoiceNumber: "M17-10351574",
			area: "F",
			debtor: "PRT / CLARO",
			po: "",
			amount: 227.02,
		},
		{
			invoiceDate: new Date("2026-08-17"),
			invoiceNumber: "M17-10351593",
			area: "E",
			debtor: "PRT / CLARO",
			po: "",
			amount: 999.6,
		},
	],
	total: 1226.62,
	advance: 981.3,
	date: new Date("2026-08-05"),
	seller: "JAF COM",
}

async function load(buf: Buffer): Promise<ExcelJS.Worksheet> {
	const wb = new ExcelJS.Workbook()
	await wb.xlsx.load(buf as unknown as ExcelJS.Buffer)
	const ws = wb.getWorksheet("FECHA")
	if (!ws) throw new Error("FECHA sheet missing")
	return ws
}

function findRow(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row {
	let found: ExcelJS.Row | undefined
	ws.eachRow((row) => {
		if (
			String(row.getCell(1).value ?? "")
				.trim()
				.startsWith(label)
		)
			found = row
	})
	if (!found) throw new Error(`row not found: ${label}`)
	return found
}

describe("generateScheduleXlsx", () => {
	it("writes the header, one row per invoice, and the totals block", async () => {
		const ws = await load(await generateScheduleXlsx(base))
		const header = findRow(ws, "Inv. Date")
		expect(header.values).toContain("Invoice #")
		expect(findRow(ws, "SCHEDULE OF ACCOUNTS")).toBeDefined()
		const first = header.number + 1
		expect(ws.getRow(first).getCell(2).value).toBe("M17-10351574")
		expect(ws.getRow(first).getCell(3).value).toBe("F")
		expect(ws.getRow(first + 1).getCell(6).value).toBe(999.6)
		expect(findRow(ws, "DO NOT WRITE BELOW THIS LINE")).toBeDefined()
		expect(findRow(ws, "TOTAL:").getCell(6).value).toBe(1226.62)
		expect(findRow(ws, "ADVANCE:").getCell(6).value).toBe(981.3)
		expect(findRow(ws, "ADJUSTMENTS:")).toBeDefined()
		expect(findRow(ws, "CASH PAYMENT:")).toBeDefined()
	})

	it("includes the assignment text and seller block", async () => {
		const ws = await load(await generateScheduleXlsx(base))
		let text = ""
		ws.eachRow((r) => {
			text += `${(r.values as unknown[]).map((v) => String(v ?? "")).join(" ")}\n`
		})
		expect(text).toContain("PACIFIC BUSINESS CAPITAL CORPORATION")
		expect(text).toContain("Seller     JAF COM")
		expect(text).toContain("Date: AUGUST")
	})

	it("an empty schedule still produces a valid workbook", async () => {
		const ws = await load(
			await generateScheduleXlsx({ ...base, rows: [], total: 0, advance: 0 }),
		)
		const header = findRow(ws, "Inv. Date")
		expect(ws.getRow(header.number + 1).getCell(2).value).not.toBe(
			"M17-10351574",
		)
		expect(findRow(ws, "TOTAL:").getCell(6).value).toBe(0)
	})

	async function dateLine(date: Date) {
		const ws = await load(await generateScheduleXlsx({ ...base, date }))
		return String(findRow(ws, "Date:").getCell(1).value)
	}

	it("prints the Date line in the Puerto Rico calendar", async () => {
		expect(await dateLine(new Date("2026-08-05T15:00:00Z"))).toBe(
			"Date: AUGUST 5, 2026",
		)
		expect(await dateLine(new Date("2026-08-06T02:00:00Z"))).toBe(
			"Date: AUGUST 5, 2026",
		)
	})

	it("writes row dates as the Puerto Rico calendar day, with formats", async () => {
		const ws = await load(
			await generateScheduleXlsx({
				...base,
				rows: [
					{ ...base.rows[0], invoiceDate: new Date("2026-08-06T02:00:00Z") },
				],
			}),
		)
		const row = ws.getRow(findRow(ws, "Inv. Date").number + 1)
		const v = row.getCell(1).value
		expect(v).toBeInstanceOf(Date)
		expect((v as Date).toISOString().slice(0, 10)).toBe("2026-08-05")
		expect(row.getCell(1).numFmt).toBe("mm/dd/yy")
		expect(row.getCell(6).numFmt).toBe("#,##0.00")
	})

	it("puertoRicoCalendarDate maps instants to the PR day at UTC midnight", () => {
		expect(
			puertoRicoCalendarDate(new Date("2026-01-01T03:00:00Z")).toISOString(),
		).toBe("2025-12-31T00:00:00.000Z")
		expect(
			puertoRicoCalendarDate(new Date("2026-07-01T03:00:00Z")).toISOString(),
		).toBe("2026-06-30T00:00:00.000Z")
		expect(
			puertoRicoCalendarDate(new Date("2026-07-01T04:00:00Z")).toISOString(),
		).toBe("2026-07-01T00:00:00.000Z")
	})
})

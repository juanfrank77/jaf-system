import ExcelJS from "exceljs"
import type { AvisoSummary, Dated } from "~/lib/aviso-summary"
import { puertoRicoCalendarDate } from "~/lib/bank-schedule-xlsx.server"

const MONEY = "#,##0.00"
const DATE = "mm/dd/yyyy"
export const MISSING = "MISSING"

/**
 * A date is MISSING when something that comes after it in the process has
 * already happened (so it should exist) and it is not there. A date for a step
 * that simply has not happened yet is left blank.
 */
export function missingFlags(chain: Dated[]): boolean[] {
	return chain.map(
		(d, i) => !d.at && chain.slice(i + 1).some((later) => later.at),
	)
}

type Cell = string | number | Date | null

const date = (d: Dated, missing: boolean): Cell =>
	d.at ? puertoRicoCalendarDate(new Date(d.at)) : missing ? MISSING : null

const PO_HEADERS = [
	"PO #",
	"PO date",
	"PO amount",
	"Invoice #",
	"Loaded in Ariba",
	"Due date",
	"Claro paid date",
	"Net paid",
	"Voucher",
	"Days",
]

function rowCells(r: AvisoSummary, poSlots: number): Cell[] {
	const a = r.armA
	const armA = missingFlags([
		a.released,
		a.accepted,
		a.sold,
		a.payrollRequest,
		a.brigadePaid,
	])
	const cells: Cell[] = [
		r.avisoNumber,
		r.controlNumber,
		r.address,
		r.supervisor,
		r.brigades.join(", "),
		date(r.jobCompleted, !!a.released.at),
		r.controlNumber,
		r.invoice.subtotal,
		r.invoice.ivu4,
		r.invoice.ivu115,
		r.invoice.total,
		date(a.accepted, armA[1]),
		a.batchNumber,
		date(a.sold, armA[2]),
		date(a.payrollRequest, armA[3]),
		date(a.brigadePaid, armA[4]),
		a.days,
	]
	for (let i = 0; i < poSlots; i++) {
		const p = r.pos[i]
		if (!p) {
			cells.push(...PO_HEADERS.map(() => null))
			continue
		}
		const flags = missingFlags([p.made, p.loaded, p.paid])
		cells.push(
			p.poNumber,
			date(p.poDate, true),
			p.poAmount,
			p.invoiceNumber,
			date(p.loaded, flags[1]),
			date(p.due, !!p.loaded.at),
			date(p.paid, false),
			p.netPaid,
			p.voucher,
			p.days,
		)
	}
	cells.push(
		r.money.stillToPo,
		r.money.outstanding,
		r.oldestOpenPoDays,
		a.closed ? "Closed" : "Open",
		r.armB === "CLOSED" ? "Closed" : r.armB === "OPEN" ? "Open" : "Not started",
		r.done ? "Done" : "Open",
	)
	return cells
}

/** The Ledger as Excel: one row per Aviso, the PO columns repeated per PO. */
export async function generateLedgerXlsx(
	rows: AvisoSummary[],
): Promise<Buffer> {
	const poSlots = Math.max(1, ...rows.map((r) => r.pos.length))
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Ledger")
	const headers = [
		"Aviso #",
		"Work order",
		"Address",
		"Supervisor",
		"Brigade(s)",
		"Job completed",
		"Invoice #",
		"Subtotal",
		"IVU 4%",
		"IVU 11.5%",
		"Total",
		"Accepted",
		"PBCC batch #",
		"Sold to PBCC",
		"Payroll request",
		"Brigade paid",
		"Arm A days",
		...Array.from({ length: poSlots }, (_, i) =>
			PO_HEADERS.map((h) => `${h} ${i + 1}`),
		).flat(),
		"Still to be PO'd",
		"Outstanding $",
		"Oldest open PO days",
		"Arm A status",
		"Arm B status",
		"Aviso status",
	]
	const T = "text" as const
	const M = "money" as const
	const D = "date" as const
	const kinds = [
		T,
		T,
		T,
		T,
		T,
		D,
		T,
		M,
		M,
		M,
		M,
		D,
		T,
		D,
		D,
		D,
		T,
		...Array.from({ length: poSlots }, () => [
			T,
			D,
			M,
			T,
			D,
			D,
			D,
			M,
			T,
			T,
		]).flat(),
		M,
		M,
		T,
		T,
		T,
		T,
	]
	const head = ws.addRow(headers)
	head.font = { bold: true }
	ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }]
	for (const r of rows) {
		const row = ws.addRow(rowCells(r, poSlots))
		row.eachCell({ includeEmpty: true }, (cell, col) => {
			const kind = kinds[col - 1]
			if (kind === "money" && typeof cell.value === "number")
				cell.numFmt = MONEY
			if (kind === "date" && cell.value instanceof Date) cell.numFmt = DATE
			if (cell.value === MISSING)
				cell.font = { color: { argb: "FFCC0000" }, bold: true }
		})
	}
	ws.columns.forEach((c) => {
		c.width = 16
	})
	ws.getColumn(3).width = 36
	return Buffer.from(await wb.xlsx.writeBuffer())
}

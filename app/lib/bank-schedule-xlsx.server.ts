import ExcelJS from "exceljs"

export type ScheduleRow = {
	invoiceDate: Date
	invoiceNumber: string
	area: string
	debtor: string
	po: string
	amount: number
}

export type ScheduleInput = {
	rows: ScheduleRow[]
	total: number
	advance: number
	date: Date
	seller: string
}

const CERTIFICATION =
	"This is to certify that the parties named below are unconditionally indebted to the undersigned in the sums opposite their respective names, for merchandise sold and delivered or for work and labor done and accepted, all in accordance with valid purchase orders and without offset, counterclaim or deduction."

const ASSIGNMENT =
	"For valuable consideration, receipt of which is hereby acknowledged, the undersigned hereby sells, assigns, sets over and transfers to PACIFIC BUSINESS CAPITAL CORPORATION, its successors or assignee, all its right, title and interest in and to the accounts above named, including all monies due or to become due thereon, all in accordance with and pursuant to that certain Accounts Receivable Purchase and Security Agreement now existing by and between the undersigned and PACIFIC BUSINESS CAPITAL CORPORATION, the conditions, representations, warranties, and agreements of which are made part of this sale and assignments and incorporated herein by reference."

const MONEY_FMT = "#,##0.00"

export async function generateScheduleXlsx(
	input: ScheduleInput,
): Promise<Buffer> {
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("FECHA")
	ws.columns = [
		{ width: 14 },
		{ width: 18 },
		{ width: 8 },
		{ width: 22 },
		{ width: 14 },
		{ width: 16 },
	]

	ws.addRow(["        SCHEDULE OF ACCOUNTS "]).font = { bold: true, size: 14 }
	const cert = ws.addRow([CERTIFICATION])
	ws.mergeCells(cert.number, 1, cert.number, 6)
	cert.alignment = { wrapText: true, vertical: "top" }
	cert.height = 48

	const header = ws.addRow([
		"Inv. Date",
		"Invoice #",
		"area",
		"Debtor Name",
		"P.O. #",
		"Invoice Amount",
	])
	header.font = { bold: true }

	for (const r of input.rows) {
		const row = ws.addRow([
			r.invoiceDate,
			r.invoiceNumber,
			r.area,
			r.debtor,
			r.po,
			r.amount,
		])
		row.getCell(1).numFmt = "mm/dd/yy"
		row.getCell(6).numFmt = MONEY_FMT
	}

	ws.addRow([])
	ws.addRow(["DO NOT WRITE BELOW THIS LINE"]).font = { bold: true }
	for (const [label, value] of [
		["TOTAL:", input.total],
		["ADVANCE:", input.advance],
	] as const) {
		const row = ws.addRow([label, null, null, null, null, value])
		row.getCell(6).numFmt = MONEY_FMT
		row.font = { bold: true }
	}
	ws.addRow(["ADJUSTMENTS:"])
	ws.addRow(["CASH PAYMENT:"])

	ws.addRow([])
	const assign = ws.addRow([ASSIGNMENT])
	ws.mergeCells(assign.number, 1, assign.number, 6)
	assign.alignment = { wrapText: true, vertical: "top" }
	assign.height = 96

	ws.addRow([])
	const date = input.date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	})
	ws.addRow([
		`Date: ${date.toUpperCase()}`,
		null,
		`Seller     ${input.seller}`,
		null,
		"By:______________________________",
		null,
	])
	ws.addRow([
		"",
		null,
		"          Company Name",
		null,
		"Authorized Agent",
		null,
	])
	ws.addRow(["", null, null, null, "Printed Name: __________________", null])

	return Buffer.from(await wb.xlsx.writeBuffer())
}

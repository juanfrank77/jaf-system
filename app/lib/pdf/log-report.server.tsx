import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
	type ViewProps,
} from "@react-pdf/renderer"
import ExcelJS from "exceljs"
import { formatLogCell, type LogColumn, type LogResult } from "~/lib/log-view"

const styles = StyleSheet.create({
	page: { padding: 28, fontFamily: "Helvetica", fontSize: 8 },
	title: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 2 },
	sub: { color: "#444", marginBottom: 1 },
	head: {
		flexDirection: "row",
		borderBottom: "0.75px solid #000",
		marginTop: 8,
		paddingBottom: 2,
		fontFamily: "Helvetica-Bold",
	},
	row: { flexDirection: "row", paddingVertical: 1.5 },
	group: {
		fontFamily: "Helvetica-Bold",
		marginTop: 6,
		borderBottom: "0.5px solid #999",
	},
	subtotal: {
		flexDirection: "row",
		borderTop: "0.5px solid #999",
		fontFamily: "Helvetica-Bold",
		paddingVertical: 1.5,
	},
	total: {
		flexDirection: "row",
		borderTop: "1px solid #000",
		fontFamily: "Helvetica-Bold",
		marginTop: 6,
		paddingTop: 2,
	},
})

const isNum = (c: LogColumn) => c.type === "money" || c.type === "number"

export type LogReportMeta = {
	title: string
	printedBy: string
	printedAt: Date
	filters: string
}

export const printStamp = (d: Date) =>
	d.toLocaleString("en-US", {
		timeZone: "America/Puerto_Rico",
		month: "2-digit",
		day: "2-digit",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})

function Row({
	columns,
	cells,
	style,
}: {
	columns: LogColumn[]
	cells: string[]
	style: ViewProps["style"]
}) {
	return (
		<View style={style} wrap={false}>
			{columns.map((c, i) => (
				<Text
					key={c.key}
					style={{
						flex: isNum(c) ? 0.9 : 1.1,
						textAlign: isNum(c) ? "right" : "left",
						paddingRight: 3,
					}}
				>
					{cells[i]}
				</Text>
			))}
		</View>
	)
}

/** The exact view, as a page of paper: header, rows, group subtotals, totals. */
export async function generateLogPdf(
	result: LogResult,
	meta: LogReportMeta,
	grouped: boolean,
): Promise<Buffer> {
	const { columns } = result
	const totalCells = (totals: Record<string, number>, label: string) =>
		columns.map((c, i) =>
			i === 0 ? label : c.total ? formatLogCell(c, totals[c.key] ?? 0) : "",
		)
	const doc = (
		<Document>
			<Page size="LETTER" orientation="landscape" style={styles.page}>
				<Text style={styles.title}>{meta.title}</Text>
				<Text style={styles.sub}>
					Printed by {meta.printedBy} · {printStamp(meta.printedAt)} ·{" "}
					{meta.filters}
				</Text>
				<Text style={styles.sub}>{result.rows.length} rows</Text>
				<Row
					columns={columns}
					cells={columns.map((c) => c.label)}
					style={styles.head}
				/>
				{result.groups.map((g) => (
					<View key={g.label || "all"}>
						{grouped && g.label ? (
							<Text style={styles.group}>{g.label}</Text>
						) : null}
						{g.rows.map((r) => (
							<Row
								key={r.id}
								columns={columns}
								cells={columns.map((c) => formatLogCell(c, r[c.key] ?? null))}
								style={styles.row}
							/>
						))}
						{grouped && g.label ? (
							<Row
								columns={columns}
								cells={totalCells(g.totals, `Subtotal · ${g.rows.length}`)}
								style={styles.subtotal}
							/>
						) : null}
					</View>
				))}
				<Row
					columns={columns}
					cells={totalCells(result.totals, `Total · ${result.rows.length}`)}
					style={styles.total}
				/>
				<Text
					fixed
					style={{ position: "absolute", bottom: 14, right: 28, color: "#666" }}
					render={({ pageNumber, totalPages }) =>
						`${pageNumber} / ${totalPages}`
					}
				/>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

/** The same rows and totals as the PDF, as a spreadsheet. */
export async function generateLogXlsx(
	result: LogResult,
	meta: LogReportMeta,
): Promise<Buffer> {
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet("Log")
	ws.addRow([meta.title])
	ws.addRow([
		`Printed by ${meta.printedBy} · ${printStamp(meta.printedAt)} · ${meta.filters}`,
	])
	ws.addRow([])
	ws.addRow(result.columns.map((c) => c.label)).font = { bold: true }
	for (const r of result.rows)
		ws.addRow(
			result.columns.map((c) => {
				const v = r[c.key] ?? null
				return c.type === "money" && typeof v === "number"
					? v
					: formatLogCell(c, v)
			}),
		)
	const totals = ws.addRow(
		result.columns.map((c, i) =>
			i === 0 ? "Total" : c.total ? (result.totals[c.key] ?? 0) : "",
		),
	)
	totals.font = { bold: true }
	result.columns.forEach((c, i) => {
		if (c.type === "money") ws.getColumn(i + 1).numFmt = "$#,##0.00"
		ws.getColumn(i + 1).width = Math.max(12, c.label.length + 4)
	})
	return Buffer.from(await wb.xlsx.writeBuffer())
}

import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { invoiceNumber, usDate, workRange, zoneOf } from "~/lib/claro-invoice"

const styles = StyleSheet.create({
	page: { padding: 36, fontFamily: "Helvetica", fontSize: 9 },
	top: { flexDirection: "row", justifyContent: "space-between" },
	company: { fontSize: 12, fontWeight: "bold" },
	title: { fontSize: 14, fontWeight: "bold", marginVertical: 10 },
	grid: { flexDirection: "row", borderTop: "0.5px solid #333" },
	cell: {
		flex: 1,
		padding: 4,
		borderBottom: "0.5px solid #333",
		borderRight: "0.5px solid #333",
	},
	label: { fontSize: 7, color: "#555", textTransform: "uppercase" },
	value: { fontSize: 10, marginTop: 2 },
	totals: { marginTop: 14, alignItems: "flex-end" },
	totalRow: {
		flexDirection: "row",
		width: 220,
		justifyContent: "space-between",
	},
	bold: { fontWeight: "bold" },
	sign: {
		marginTop: 50,
		borderTop: "1px solid #000",
		width: 220,
		paddingTop: 3,
	},
})

const money = (n: number) =>
	`$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type FacturaParams = {
	seq: number
	madeAt: Date
	workMonth: string
	poNumber: string
	subtotal: number
	ivu4: number
	ivu115: number
	total: number
}

/**
 * The "Factura de Pago - Claro" form. Field for field with Kay's sample:
 * number, ORG PWOR, date (month-first), Zona, work range, work type, PO, amounts
 * split by IVU rate, the total, "Total pedidos" 1. "Acceptance" stays blank (Q6).
 */
export async function generateFacturaDePagoPdf(
	p: FacturaParams,
): Promise<Buffer> {
	const range = workRange(p.workMonth)
	const Field = ({ label, value }: { label: string; value: string }) => (
		<View style={styles.cell}>
			<Text style={styles.label}>{label}</Text>
			<Text style={styles.value}>{value}</Text>
		</View>
	)
	const doc = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<View style={styles.top}>
					<Text style={styles.company}>JAF Communications, Inc.</Text>
					<Text>Page 1 of 1</Text>
				</View>
				<Text style={styles.title}>Factura de Pago - Claro</Text>
				<View style={styles.grid}>
					<Field label="Número de factura" value={invoiceNumber(p.seq)} />
					<Field label="ORG" value="PWOR" />
					<Field label="Fecha" value={usDate(p.madeAt)} />
				</View>
				<View style={styles.grid}>
					<Field label="Zona" value={zoneOf(p.workMonth)} />
					<Field
						label="Trabajo efectuado entre"
						value={`${range.from} – ${range.to}`}
					/>
					<Field label="Trabajo" value="Mantenimiento Planta Externa" />
				</View>
				<View style={styles.grid}>
					<Field label="Pedido" value={p.poNumber} />
					<Field label="Importe" value={money(p.subtotal)} />
					<Field label="IVU 11.5%" value={money(p.ivu115)} />
					<Field label="IVU 4%" value={money(p.ivu4)} />
				</View>
				<View style={styles.grid}>
					<Field label="Total pedidos" value="1" />
					<Field label='Números de "Acceptance"' value="" />
					<Field label="Cantidad a pagar" value={money(p.total)} />
				</View>
				<View style={styles.totals}>
					<View style={styles.totalRow}>
						<Text>Subtotal</Text>
						<Text>{money(p.subtotal)}</Text>
					</View>
					<View style={styles.totalRow}>
						<Text>IVU Tax 11.5%</Text>
						<Text>{money(p.ivu115)}</Text>
					</View>
					<View style={styles.totalRow}>
						<Text>IVU Tax 4%</Text>
						<Text>{money(p.ivu4)}</Text>
					</View>
					<View style={[styles.totalRow, styles.bold]}>
						<Text>Invoice Total</Text>
						<Text>{money(p.total)}</Text>
					</View>
				</View>
				<Text style={styles.sign}>Firma:</Text>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { computeInvoiceTotals } from "~/lib/invoice-totals"

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 9 },
	title: {
		fontSize: 13,
		fontWeight: "bold",
		textAlign: "center",
		marginBottom: 4,
	},
	subtitle: { fontSize: 10, textAlign: "center", marginBottom: 12 },
	headerRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 3,
	},
	label: { color: "#555" },
	section: { marginTop: 10 },
	sectionTitle: { fontWeight: "bold", marginBottom: 4, fontSize: 9 },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#e2e8f0",
		padding: 3,
		fontSize: 8,
	},
	tableRow: {
		flexDirection: "row",
		padding: 3,
		borderBottom: "0.5px solid #cbd5e1",
	},
	c1: { flex: 1.5 },
	c2: { flex: 3 },
	c3: { flex: 1, textAlign: "right" },
	c4: { flex: 1, textAlign: "right" },
	c5: { flex: 1.5, textAlign: "right" },
	c6: { flex: 1 },
	totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
	bold: { fontWeight: "bold" },
})

interface LineItem {
	claroCode: string
	name: string
	qty: number
	unit: string
	unitPrice: number
	accountCode?: string | null
}

export async function generateActaConformidadPdf(params: {
	controlNumber: string
	avisoNumber?: string | null
	jobType: string
	jobAddress: string
	invoiceNumber: string
	invoiceDate: string
	lineItems: LineItem[]
	supervisorName: string
	/** The Claro supervisor who dispatched the work; omitted when none is set. */
	claroSupervisorName?: string | null
	ivuRate: number // fetched from system_settings — never hardcoded
}): Promise<Buffer> {
	const totals = computeInvoiceTotals(params.lineItems, params.ivuRate)
	const items = params.lineItems.map((item, i) => ({
		...item,
		amount: totals.lines[i].lineAmount,
	}))
	const { subtotal, ivu, total } = totals

	const element = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<Text style={styles.title}>ACTA DE CONFORMIDAD</Text>
				<Text style={styles.subtitle}>JAF Communications, Inc.</Text>

				<View style={styles.headerRow}>
					<Text>
						<Text style={styles.label}>Numero Suplidor: </Text>V0000000006
					</Text>
					<Text>
						<Text style={styles.label}>Numero de Factura: </Text>
						{params.invoiceNumber}
					</Text>
					<Text>
						<Text style={styles.label}>ORG: </Text>PWOR
					</Text>
					<Text>
						<Text style={styles.label}>Fecha: </Text>
						{params.invoiceDate}
					</Text>
				</View>
				{params.avisoNumber && (
					<View style={styles.headerRow}>
						<Text>
							<Text style={styles.label}>Orden Trabajo Planta: </Text>
							{params.avisoNumber}
						</Text>
						<Text>
							<Text style={styles.label}>Control #: </Text>
							{params.controlNumber}
						</Text>
					</View>
				)}
				<View style={styles.headerRow}>
					<Text>
						<Text style={styles.label}>Trabajo: </Text>
						{params.jobType}
					</Text>
					<Text>
						<Text style={styles.label}>Zona: </Text>
						{params.jobAddress}
					</Text>
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Detalle de Servicios</Text>
					<View style={styles.tableHeader}>
						<Text style={styles.c1}>Código</Text>
						<Text style={styles.c2}>Descripción</Text>
						<Text style={styles.c3}>Cant</Text>
						<Text style={styles.c4}>Precio Unit</Text>
						<Text style={styles.c5}>Importe</Text>
						<Text style={styles.c6}>A/C</Text>
					</View>
					{items.map((item, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: react-pdf renders to static buffer, no reconciliation
						<View key={`${item.claroCode}-${i}`} style={styles.tableRow}>
							<Text style={styles.c1}>{item.claroCode}</Text>
							<Text style={styles.c2}>{item.name}</Text>
							<Text style={styles.c3}>
								{item.qty} {item.unit}
							</Text>
							<Text style={styles.c4}>${item.unitPrice.toFixed(4)}</Text>
							<Text style={styles.c5}>${item.amount.toFixed(2)}</Text>
							<Text style={styles.c6}>{item.accountCode ?? ""}</Text>
						</View>
					))}
				</View>

				<View style={{ marginTop: 12 }}>
					<View style={styles.totalRow}>
						<Text>Subtotal: ${subtotal.toFixed(2)}</Text>
					</View>
					<View style={styles.totalRow}>
						<Text>
							IVU ({(params.ivuRate * 100).toFixed(1)}%): ${ivu.toFixed(2)}
						</Text>
					</View>
					<View style={styles.totalRow}>
						<Text style={styles.bold}>Total a Pagar: ${total.toFixed(2)}</Text>
					</View>
				</View>

				<View
					style={{ marginTop: 24, borderTop: "1px solid #ccc", paddingTop: 12 }}
				>
					<Text>
						Autorizado por: ________________________ Fecha: ___________
					</Text>
					<Text style={{ marginTop: 4 }}>
						Supervisor: {params.supervisorName}
					</Text>
					{params.claroSupervisorName ? (
						<Text>Supervisor de Claro: {params.claroSupervisorName}</Text>
					) : null}
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

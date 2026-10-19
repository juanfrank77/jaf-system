/**
 * The PRICED JAF invoice (unit prices, amounts, IVU, total). Finance/Admin
 * only: rendered on demand by `finance/verify/:id/invoice.pdf` from the lines
 * locked at the first packet send. Never import it from a route a price-blind
 * role (SUPERVISOR, CREW, WAREHOUSE) can reach; Claro gets the price-free
 * packet (claro-packet.server.tsx).
 */
import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 9 },
	header: { marginBottom: 20 },
	title: { fontSize: 15, fontWeight: "bold", marginBottom: 2 },
	subtitle: { fontSize: 9, color: "#555", marginBottom: 14 },
	row: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 3,
	},
	label: { color: "#666" },
	billTo: { marginTop: 14, marginBottom: 4 },
	table: { marginTop: 12 },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#1e3a5f",
		color: "#fff",
		padding: 4,
		fontSize: 8,
	},
	tableRow: {
		flexDirection: "row",
		padding: 4,
		borderBottom: "0.5px solid #e2e8f0",
		fontSize: 8,
	},
	c1: { flex: 1.3 },
	c2: { flex: 2.2 },
	c3: { flex: 0.8, textAlign: "right" },
	c4: { flex: 0.9, textAlign: "right" },
	c5: { flex: 1.3, textAlign: "right" },
	c6: { flex: 1, textAlign: "right" },
	totals: { marginTop: 14 },
	totalRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		marginBottom: 2,
		fontSize: 8,
	},
	bold: { fontWeight: "bold" },
	footer: { marginTop: 28, borderTop: "1px solid #ccc", paddingTop: 12 },
})

interface LineItem {
	claroCode: string
	name: string
	qty: number
	unit: string
	unitPrice: number
	accountCode?: string | null
}

interface JafInvoiceParams {
	controlNumber: string
	avisoNumber?: string | null
	jobType: string
	jobAddress: string
	brigadeName?: string | null
	workDate?: string
	invoiceDate: string
	invoiceNumber: string
	debtor: string
	lineItems: LineItem[]
	ivuRate: number
	supervisorName: string
}

export async function generateJafInvoicePdf(
	params: JafInvoiceParams,
): Promise<Buffer> {
	let subtotal = 0
	const items = params.lineItems.map((item) => {
		const amount = Number(item.qty) * Number(item.unitPrice)
		subtotal += amount
		return { ...item, amount }
	})
	const ivu = subtotal * params.ivuRate
	const total = subtotal + ivu

	const element = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<View style={styles.header}>
					<Text style={styles.title}>JAF INVOICE</Text>
					<Text style={styles.subtitle}>
						JAF Communications, Inc. — V0000000006 — ORG: PWOR
					</Text>
				</View>

				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Invoice #: </Text>
						{params.invoiceNumber}
					</Text>
					<Text>
						<Text style={styles.label}>Date: </Text>
						{params.invoiceDate}
					</Text>
					<Text>
						<Text style={styles.label}>Debtor: </Text>
						{params.debtor}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Control #: </Text>
						{params.controlNumber}
					</Text>
					{params.avisoNumber ? (
						<Text>
							<Text style={styles.label}>Aviso #: </Text>
							{params.avisoNumber}
						</Text>
					) : null}
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Job Type: </Text>
						{params.jobType}
					</Text>
					{params.workDate ? (
						<Text>
							<Text style={styles.label}>Work date: </Text>
							{params.workDate}
						</Text>
					) : null}
					{params.brigadeName ? (
						<Text>
							<Text style={styles.label}>Brigade: </Text>
							{params.brigadeName}
						</Text>
					) : null}
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Address: </Text>
						{params.jobAddress}
					</Text>
				</View>

				<View style={styles.table}>
					<View style={styles.tableHeader}>
						<Text style={styles.c1}>Code</Text>
						<Text style={styles.c2}>Description</Text>
						<Text style={styles.c3}>Qty</Text>
						<Text style={styles.c4}>Unit</Text>
						<Text style={styles.c5}>Unit Price</Text>
						<Text style={styles.c6}>Amount</Text>
					</View>
					{items.map((item, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: react-pdf renders to static buffer, no reconciliation
						<View key={`${item.claroCode}-${i}`} style={styles.tableRow}>
							<Text style={styles.c1}>{item.claroCode}</Text>
							<Text style={styles.c2}>{item.name}</Text>
							<Text style={styles.c3}>
								{item.qty} {item.unit}
							</Text>
							<Text style={styles.c4}>{item.unit}</Text>
							<Text style={styles.c5}>
								${Number(item.unitPrice).toFixed(4)}
							</Text>
							<Text style={styles.c6}>${Number(item.amount).toFixed(2)}</Text>
						</View>
					))}
				</View>

				<View style={styles.totals}>
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

				<View style={styles.footer}>
					<Text>
						<Text style={styles.label}>Authorized by: </Text>
						{params.supervisorName}
					</Text>
					<Text style={{ marginTop: 4 }}>
						Claro Work Order (Aviso) #: {params.avisoNumber ?? "—"}
					</Text>
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

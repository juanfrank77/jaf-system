import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 10 },
	header: { marginBottom: 24 },
	title: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
	subtitle: { fontSize: 9, color: "#555", marginBottom: 16 },
	section: { marginBottom: 14 },
	sectionTitle: {
		fontSize: 10,
		fontWeight: "bold",
		marginBottom: 6,
		borderBottom: "0.5px solid #ccc",
		paddingBottom: 2,
	},
	row: { flexDirection: "row", marginBottom: 4 },
	label: { width: 140, color: "#666" },
	value: { flex: 1 },
	table: { marginTop: 8 },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#1e3a5f",
		color: "#fff",
		padding: 5,
		fontSize: 9,
	},
	tableRow: {
		flexDirection: "row",
		padding: 5,
		borderBottom: "0.5px solid #e2e8f0",
		fontSize: 9,
	},
	c1: { flex: 1.4 },
	c2: { flex: 2.4 },
	c3: { flex: 0.8, textAlign: "right" },
	c4: { flex: 1, textAlign: "right" },
	c5: { flex: 1.2, textAlign: "right" },
	totals: { marginTop: 14, alignItems: "flex-end" },
	totalRow: { flexDirection: "row", marginBottom: 2, fontSize: 9 },
	bold: { fontWeight: "bold" },
	footer: { marginTop: 32, borderTop: "1px solid #ccc", paddingTop: 12 },
	signatureBox: {
		marginTop: 40,
		borderTop: "1px solid #000",
		width: 240,
		paddingTop: 4,
	},
	note: { fontSize: 8, color: "#666", marginTop: 4 },
})

interface LineItem {
	claroCode: string
	name: string
	qty: number
	unit: string
	unitPrice: number
}

interface FinalClaroDocParams {
	controlNumber: string
	avisoNumber?: string | null
	claroPONumber?: string | null
	jobType: string
	jobAddress: string
	invoiceNumber: string
	invoiceDate: string
	lineItems: LineItem[]
	ivuRate: number
	supervisorName: string
	generatedDate: string
}

export async function generateFinalClaroDocPdf(
	params: FinalClaroDocParams,
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
					<Text style={styles.title}>Final Claro Payment Document</Text>
					<Text style={styles.subtitle}>
						JAF Communications, Inc. — Upload to Claro Portal
					</Text>
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Reference</Text>
					<View style={styles.row}>
						<Text style={styles.label}>JAF Control #:</Text>
						<Text style={styles.value}>{params.controlNumber}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Claro Aviso #:</Text>
						<Text style={styles.value}>{params.avisoNumber ?? "—"}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Claro PO #:</Text>
						<Text style={styles.value}>{params.claroPONumber ?? "—"}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>JAF Invoice #:</Text>
						<Text style={styles.value}>{params.invoiceNumber}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Invoice Date:</Text>
						<Text style={styles.value}>{params.invoiceDate}</Text>
					</View>
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Work Description</Text>
					<View style={styles.row}>
						<Text style={styles.label}>Job Type:</Text>
						<Text style={styles.value}>{params.jobType}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Job Address:</Text>
						<Text style={styles.value}>{params.jobAddress}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Supervisor:</Text>
						<Text style={styles.value}>{params.supervisorName}</Text>
					</View>
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Summary of Charges</Text>
					<View style={styles.table}>
						<View style={styles.tableHeader}>
							<Text style={styles.c1}>Claro Code</Text>
							<Text style={styles.c2}>Description</Text>
							<Text style={styles.c3}>Qty</Text>
							<Text style={styles.c4}>Unit Price</Text>
							<Text style={styles.c5}>Amount</Text>
						</View>
						{items.map((item, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: react-pdf renders to static buffer
							<View key={`${item.claroCode}-${i}`} style={styles.tableRow}>
								<Text style={styles.c1}>{item.claroCode}</Text>
								<Text style={styles.c2}>{item.name}</Text>
								<Text style={styles.c3}>
									{item.qty} {item.unit}
								</Text>
								<Text style={styles.c4}>
									${Number(item.unitPrice).toFixed(4)}
								</Text>
								<Text style={styles.c5}>${Number(item.amount).toFixed(2)}</Text>
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
							<Text style={styles.bold}>Total Amount: ${total.toFixed(2)}</Text>
						</View>
					</View>
				</View>

				<View style={styles.footer}>
					<View style={styles.row}>
						<Text style={styles.label}>Document Generated:</Text>
						<Text style={styles.value}>{params.generatedDate}</Text>
					</View>
					<View style={styles.signatureBox}>
						<Text>Authorized Signature</Text>
						<Text style={styles.note}>
							Sign and date before uploading to Claro
						</Text>
					</View>
					<Text style={styles.note}>
						Upload this signed document into Claro's portal to queue the job for
						final payment.
					</Text>
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

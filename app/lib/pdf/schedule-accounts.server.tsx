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
	title: {
		fontSize: 14,
		fontWeight: "bold",
		textAlign: "center",
		marginBottom: 4,
	},
	to: { textAlign: "center", marginBottom: 12, color: "#555" },
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
	c1: { flex: 1.5 },
	c2: { flex: 1.5 },
	c3: { flex: 2 },
	c4: { flex: 1.5 },
	c5: { flex: 2, textAlign: "right" },
	totals: { marginTop: 12 },
	totalRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		marginBottom: 2,
	},
	signature: { marginTop: 32, borderTop: "1px solid #ccc", paddingTop: 12 },
})

interface ScheduleInvoice {
	invoiceDate: string
	invoiceNumber: string
	debtor: string
	poNumber: string
	amount: number
}

export async function generateScheduleAccountsPdf(params: {
	invoices: ScheduleInvoice[]
	advancePercent?: number
	agentName?: string
}): Promise<Buffer> {
	const { invoices, advancePercent = 80, agentName = "Monica" } = params
	const total = invoices.reduce((sum, i) => sum + i.amount, 0)
	const advance = total * (advancePercent / 100)

	const element = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<Text style={styles.title}>SCHEDULE OF ACCOUNTS</Text>
				<Text style={styles.to}>
					Submitted to: Pacific Business Capital Corporation — Hortencia Smith
					(hs@pbcc.com)
				</Text>
				<Text
					style={{
						textAlign: "center",
						marginBottom: 12,
						color: "#555",
						fontSize: 8,
					}}
				>
					JAF Communications, Inc. — V0000000006
				</Text>

				<View style={styles.tableHeader}>
					<Text style={styles.c1}>Inv. Date</Text>
					<Text style={styles.c2}>Invoice #</Text>
					<Text style={styles.c3}>Debtor</Text>
					<Text style={styles.c4}>P.O. #</Text>
					<Text style={styles.c5}>Invoice Amount</Text>
				</View>
				{invoices.map((inv, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: react-pdf renders to static buffer, no reconciliation
					<View key={`${inv.invoiceNumber}-${i}`} style={styles.tableRow}>
						<Text style={styles.c1}>{inv.invoiceDate}</Text>
						<Text style={styles.c2}>{inv.invoiceNumber}</Text>
						<Text style={styles.c3}>{inv.debtor}</Text>
						<Text style={styles.c4}>{inv.poNumber}</Text>
						<Text style={styles.c5}>${inv.amount.toFixed(2)}</Text>
					</View>
				))}

				<View style={styles.totals}>
					<View style={styles.totalRow}>
						<Text>Total: ${total.toFixed(2)}</Text>
					</View>
					<View style={styles.totalRow}>
						<Text>
							Advance ({advancePercent}%): ${advance.toFixed(2)}
						</Text>
					</View>
					<View style={styles.totalRow}>
						<Text>Adjustments: $0.00</Text>
					</View>
					<View style={styles.totalRow}>
						<Text style={{ fontWeight: "bold" }}>
							Cash Payment: ${advance.toFixed(2)}
						</Text>
					</View>
				</View>

				<View style={styles.signature}>
					<Text>Authorized Agent: ________________________</Text>
					<Text style={{ marginTop: 4 }}>{agentName}</Text>
					<Text style={{ marginTop: 8 }}>Date: ___________</Text>
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

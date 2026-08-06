import {
	Document,
	Image,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { toNumberPrice } from "~/lib/utils"

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 10 },
	header: { marginBottom: 16 },
	title: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
	row: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 3,
	},
	label: { color: "#666" },
	table: { marginTop: 12 },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#f1f5f9",
		padding: 4,
		marginBottom: 2,
	},
	tableRow: {
		flexDirection: "row",
		padding: 4,
		borderBottom: "1px solid #e2e8f0",
	},
	col1: { flex: 2 },
	col2: { flex: 3 },
	col3: { flex: 1, textAlign: "right" },
	col4: { flex: 1, textAlign: "right" },
	signatureSection: {
		marginTop: 24,
		borderTop: "1px solid #ccc",
		paddingTop: 12,
	},
	total: {
		marginTop: 12,
		flexDirection: "row",
		justifyContent: "flex-end",
		fontWeight: "bold",
	},
})

export async function generateWarehouseReceiptPdf(
	doc: {
		controlNumber: string
		jobType: string
		jobAddressEstimated: string
		avisoNumber?: string | null
		materialsTaken: { serviceCodeId: string; qty: number }[]
		releaseSignature?: string | null
		crewSignature?: string | null
		signedAt?: Date | null
	},
	serviceCodes: {
		id: string
		claroCode: string
		name: string
		unit: string
		unitPrice: number
	}[],
	warehouseName: string,
): Promise<Buffer> {
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	let totalAmount = 0
	const lineItems = doc.materialsTaken.map((item) => {
		const code = codeMap[item.serviceCodeId]
		const amount = toNumberPrice(code?.unitPrice ?? 0) * item.qty
		totalAmount += amount
		return { code, qty: item.qty, amount, serviceCodeId: item.serviceCodeId }
	})

	const element = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<View style={styles.header}>
					<Text style={styles.title}>Warehouse Receipt</Text>
					<Text>JAF Communications, Inc.</Text>
				</View>

				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Control #: </Text>
						{doc.controlNumber}
					</Text>
					<Text>
						<Text style={styles.label}>Date: </Text>
						{doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : "—"}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Job Type: </Text>
						{doc.jobType}
					</Text>
					{doc.avisoNumber ? (
						<Text>
							<Text style={styles.label}>Aviso #: </Text>
							{doc.avisoNumber}
						</Text>
					) : null}
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Warehouse: </Text>
						{warehouseName}
					</Text>
				</View>

				<View style={styles.table}>
					<View style={styles.tableHeader}>
						<Text style={styles.col1}>Code</Text>
						<Text style={styles.col2}>Description</Text>
						<Text style={styles.col3}>Qty</Text>
						<Text style={styles.col4}>Amount</Text>
					</View>
					{lineItems.map(({ code, qty, amount, serviceCodeId }) => (
						<View key={serviceCodeId} style={styles.tableRow}>
							<Text style={styles.col1}>{code?.claroCode ?? "—"}</Text>
							<Text style={styles.col2}>{code?.name ?? "—"}</Text>
							<Text style={styles.col3}>
								{qty} {code?.unit}
							</Text>
							<Text style={styles.col4}>${amount.toFixed(2)}</Text>
						</View>
					))}
				</View>

				<View style={styles.total}>
					<Text>Total: ${totalAmount.toFixed(2)}</Text>
				</View>

				<View style={styles.signatureSection}>
					<View style={{ flexDirection: "row", gap: 24 }}>
						<View style={{ flex: 1 }}>
							<Text style={{ marginBottom: 4, fontSize: 9 }}>
								Warehouse Release:
							</Text>
							{doc.releaseSignature ? (
								<Image
									src={doc.releaseSignature}
									style={{ height: 40, width: 160 }}
								/>
							) : null}
							<Text style={{ marginTop: 2, fontSize: 8, color: "#666" }}>
								{warehouseName}
							</Text>
						</View>
						<View style={{ flex: 1 }}>
							<Text style={{ marginBottom: 4, fontSize: 9 }}>
								Crew Receipt:
							</Text>
							{doc.crewSignature ? (
								<Image
									src={doc.crewSignature}
									style={{ height: 40, width: 160 }}
								/>
							) : null}
							<Text style={{ marginTop: 2, fontSize: 8, color: "#666" }}>
								{doc.signedAt ? new Date(doc.signedAt).toLocaleString() : ""}
							</Text>
						</View>
					</View>
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

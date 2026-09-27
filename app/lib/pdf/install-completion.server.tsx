import {
	Document,
	Image,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 10 },
	title: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
	row: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 3,
	},
	label: { color: "#666" },
	tableRow: {
		flexDirection: "row",
		padding: 4,
		borderBottom: "1px solid #e2e8f0",
	},
	c1: { flex: 2 },
	c2: { flex: 3 },
	c3: { flex: 1, textAlign: "right" },
	sig: { marginTop: 24, borderTop: "1px solid #ccc", paddingTop: 12 },
})

export async function generateInstallCompletionPdf(data: {
	claroOrderNo: string
	installerName: string
	jafNumber: string
	toaNumber: string
	address: string
	serialInstalled?: string | null
	modelResolved?: string | null
	dropFt?: number | null
	accessories: { code: string; name: string; qty: number }[]
	installedAt: Date
	signature?: string | null
}): Promise<Buffer> {
	const el = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<Text style={styles.title}>
					Contrato y Aceptación de Instalación — JAF Communications, Inc.
				</Text>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Orden Claro: </Text>
						{data.claroOrderNo}
					</Text>
					<Text>
						<Text style={styles.label}>Fecha: </Text>
						{data.installedAt.toLocaleDateString()}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Instalador: </Text>
						{data.installerName}
					</Text>
					<Text>
						<Text style={styles.label}>JAF #: </Text>
						{data.jafNumber} <Text style={styles.label}>TOA #: </Text>
						{data.toaNumber}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Dirección: </Text>
						{data.address}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Serial: </Text>
						{data.serialInstalled ?? "—"} ({data.modelResolved ?? "?"})
					</Text>
					<Text>
						<Text style={styles.label}>Drop: </Text>
						{data.dropFt ?? "—"} ft
					</Text>
				</View>
				{data.accessories.map((a) => (
					<View key={a.code} style={styles.tableRow}>
						<Text style={styles.c1}>{a.code}</Text>
						<Text style={styles.c2}>{a.name}</Text>
						<Text style={styles.c3}>{a.qty}</Text>
					</View>
				))}
				<View style={styles.sig}>
					<Text style={{ fontSize: 9, marginBottom: 4 }}>
						Firma Instalador — {data.installerName}
					</Text>
					{data.signature ? (
						<Image src={data.signature} style={{ height: 40, width: 160 }} />
					) : null}
				</View>
			</Page>
		</Document>
	)
	return renderToBuffer(el)
}

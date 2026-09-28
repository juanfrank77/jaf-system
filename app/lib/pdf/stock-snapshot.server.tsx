import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"

const s = StyleSheet.create({
	page: { padding: 32, fontFamily: "Helvetica", fontSize: 9 },
	h: { fontSize: 14, marginBottom: 8 },
	row: { flexDirection: "row" },
	headerRow: { flexDirection: "row", marginTop: 10, fontWeight: "bold" },
	cell: { flex: 1 },
})

export function renderSnapshotPdf(data: {
	warehouseName: string
	asOfDate: Date
	bulk: {
		serviceCodeId: string
		canonicalName: string
		onHand: number
		stockUnit: string | null
		derivedCountQty: number | null
		countUnit: string | null
	}[]
	serial: { serviceCodeId: string; condition: string; count: number }[]
}): Promise<Uint8Array> {
	return renderToBuffer(
		<Document>
			<Page style={s.page}>
				<Text style={s.h}>JAF · Stock Snapshot — {data.warehouseName}</Text>
				<Text>As of: {data.asOfDate.toISOString().slice(0, 10)}</Text>
				<View style={s.headerRow}>
					<Text style={s.cell}>Material</Text>
					<Text style={s.cell}>On hand</Text>
					<Text style={s.cell}>Count</Text>
				</View>
				{data.bulk.map((b) => (
					<View key={b.serviceCodeId} style={s.row}>
						<Text style={s.cell}>{b.canonicalName}</Text>
						<Text style={s.cell}>
							{b.onHand} {b.stockUnit ?? ""}
						</Text>
						<Text style={s.cell}>
							{b.derivedCountQty != null
								? `${b.derivedCountQty} ${b.countUnit ?? ""}`
								: "—"}
						</Text>
					</View>
				))}
				<Text style={{ marginTop: 12 }}>
					Serialized: {data.serial.reduce((n, r) => n + r.count, 0)} units
				</Text>
			</Page>
		</Document>,
	)
}

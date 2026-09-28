import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { db } from "~/lib/db.server"

const s = StyleSheet.create({
	page: { padding: 32, fontFamily: "Helvetica", fontSize: 10 },
	row: { flexDirection: "row" },
	headerRow: { flexDirection: "row", marginTop: 12, fontWeight: "bold" },
	h: { fontSize: 14, marginBottom: 8 },
	cell: { flex: 1 },
})

export async function generateRepairBatchPdf(
	batchId: string,
): Promise<Uint8Array> {
	const batch = await db.repairBatch.findUniqueOrThrow({
		where: { id: batchId },
		include: { warehouse: true },
	})
	const members = await db.stockMovement.findMany({
		where: { refRepairBatchId: batchId, type: "SENT_FOR_REPAIR" },
		select: { serial: true, serviceCodeId: true },
	})
	const ids = [...new Set(members.map((m) => m.serviceCodeId))]
	const codes = await db.serviceCode
		.findMany({
			where: { id: { in: ids } },
			select: { id: true, claroCode: true, ownership: true },
		})
		.catch(() => [] as { id: string; claroCode: string; ownership: string }[])
	const byId = new Map(codes.map((c) => [c.id, c]))
	// Display the Claro code, not the cuid FK.
	const claroOf = (id: string) => byId.get(id)?.claroCode ?? "(unknown)"
	const ownerOf = (id: string) => byId.get(id)?.ownership ?? "UNKNOWN"
	return renderToBuffer(
		<Document>
			<Page style={s.page}>
				<Text style={s.h}>JAF · Claro Repair Batch {batch.id}</Text>
				<Text>
					Warehouse: {batch.warehouse.name} · Sent:{" "}
					{batch.sentAt.toISOString().slice(0, 10)}
				</Text>
				<View style={s.headerRow}>
					<Text style={s.cell}>Serial</Text>
					<Text style={s.cell}>Model</Text>
					<Text style={s.cell}>Ownership</Text>
				</View>
				{members.map((m) => (
					<View key={m.serial} style={s.row}>
						<Text style={s.cell}>{m.serial}</Text>
						<Text style={s.cell}>{claroOf(m.serviceCodeId)}</Text>
						<Text style={s.cell}>
							{ownerOf(m.serviceCodeId)}
							{ownerOf(m.serviceCodeId) === "UNKNOWN" ? " (unconfirmed)" : ""}
						</Text>
					</View>
				))}
				<Text style={{ marginTop: 16 }}>Total units: {members.length}</Text>
			</Page>
		</Document>,
	)
}

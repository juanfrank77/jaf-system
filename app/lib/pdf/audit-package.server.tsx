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
	page: { padding: 36, fontFamily: "Helvetica", fontSize: 9 },
	h1: { fontSize: 14, fontWeight: "bold", marginBottom: 4 },
	h2: {
		fontSize: 10,
		fontWeight: "bold",
		marginTop: 12,
		marginBottom: 4,
		borderBottom: "0.5px solid #ccc",
		paddingBottom: 2,
	},
	row: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 2,
	},
	label: { color: "#555" },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#f1f5f9",
		padding: 3,
		fontSize: 8,
	},
	tableRow: {
		flexDirection: "row",
		padding: 3,
		borderBottom: "0.5px solid #e2e8f0",
		fontSize: 8,
	},
	c1: { flex: 2 },
	c2: { flex: 3 },
	c3: { flex: 1, textAlign: "right" },
	c4: { flex: 1, textAlign: "right" },
	sigBox: { flex: 1 },
})

interface AuditDoc {
	controlNumber: string
	jobType: string
	jobAddressEstimated: string
	jobAddressActual?: string | null
	avisoNumber?: string | null
	createdAt: Date
	signedAt?: Date | null
	supervisorApprovedAt?: Date | null
	lcGeneratedAt?: Date | null
	releaseSignature?: string | null
	crewSignature?: string | null
	warehouseName?: string | null
	brigades?: AuditBrigade[]
	materialsTaken: { serviceCodeId: string; qty: number }[]
	materialsUsed: { serviceCodeId: string; qty: number }[]
	auditTrail: { action: string; timestamp: Date; user: { name: string } }[]
	photos: { localPath: string }[]
}

export type AuditBrigade = { name: string; code: string | null }

/** Text for the Brigades section; the payment note only applies to shared jobs. */
export function describeBrigades(brigades: AuditBrigade[]) {
	const label = (b: AuditBrigade) => (b.code ? `${b.name} · ${b.code}` : b.name)
	return {
		lines: brigades.map(label),
		note:
			brigades.length > 1
				? "Each brigade has its own certificado and is paid separately for its own work."
				: null,
	}
}

interface ServiceCodeMap {
	[id: string]: { claroCode: string; name: string; unit: string | null }
}

export async function generateAuditPackagePdf(
	doc: AuditDoc,
	codeMap: ServiceCodeMap,
): Promise<Buffer> {
	const taken = doc.materialsTaken ?? []
	const used = doc.materialsUsed ?? []
	const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))
	const crew = describeBrigades(doc.brigades ?? [])

	const element = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				{/* Header */}
				<Text style={styles.h1}>Audit Package — {doc.controlNumber}</Text>
				<Text style={{ color: "#555", marginBottom: 10, fontSize: 8 }}>
					JAF Communications, Inc. — Generated for Claro audit purposes
				</Text>

				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Job Type: </Text>
						{doc.jobType}
					</Text>
					<Text>
						<Text style={styles.label}>Created: </Text>
						{new Date(doc.createdAt).toLocaleDateString()}
					</Text>
				</View>
				<View style={styles.row}>
					<Text>
						<Text style={styles.label}>Address (estimated): </Text>
						{doc.jobAddressEstimated}
					</Text>
				</View>
				{doc.jobAddressActual && (
					<View style={styles.row}>
						<Text>
							<Text style={styles.label}>Address (actual): </Text>
							{doc.jobAddressActual}
						</Text>
					</View>
				)}
				{doc.avisoNumber && (
					<View style={styles.row}>
						<Text>
							<Text style={styles.label}>Aviso #: </Text>
							{doc.avisoNumber}
						</Text>
					</View>
				)}
				{doc.warehouseName && (
					<View style={styles.row}>
						<Text>
							<Text style={styles.label}>Warehouse: </Text>
							{doc.warehouseName}
						</Text>
					</View>
				)}

				{crew.lines.length > 0 && (
					<>
						<Text style={styles.h2}>Brigades</Text>
						{crew.lines.map((line) => (
							<Text key={line} style={{ marginBottom: 2 }}>
								{line}
							</Text>
						))}
						{crew.note && (
							<Text style={{ marginTop: 4, color: "#92400e" }}>
								{crew.note}
							</Text>
						)}
					</>
				)}

				{/* Materials issued vs used */}
				<Text style={styles.h2}>Materials — Issued vs Used</Text>
				<View style={styles.tableHeader}>
					<Text style={styles.c1}>Code</Text>
					<Text style={styles.c2}>Description</Text>
					<Text style={styles.c3}>Issued</Text>
					<Text style={styles.c4}>Used</Text>
				</View>
				{taken.map((t) => {
					const code = codeMap[t.serviceCodeId]
					const usedQty = usedMap[t.serviceCodeId] ?? 0
					const leftOver = t.qty - usedQty
					return (
						<View key={t.serviceCodeId} style={styles.tableRow}>
							<Text style={styles.c1}>{code?.claroCode ?? "—"}</Text>
							<Text style={styles.c2}>{code?.name ?? "—"}</Text>
							<Text style={styles.c3}>
								{t.qty} {code?.unit}
							</Text>
							<Text
								style={[styles.c4, leftOver > 0 ? { color: "#d97706" } : {}]}
							>
								{usedQty} {code?.unit}
							</Text>
						</View>
					)
				})}
				{taken.length === 0 && (
					<Text style={{ fontSize: 8, color: "#94a3b8", padding: 4 }}>
						No warehouse materials — crew used van stock.
					</Text>
				)}

				{/* Signatures */}
				{(doc.releaseSignature || doc.crewSignature) && (
					<>
						<Text style={styles.h2}>Signatures at Warehouse</Text>
						<View style={{ flexDirection: "row", gap: 16 }}>
							<View style={styles.sigBox}>
								<Text style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>
									Warehouse Release:
								</Text>
								{doc.releaseSignature && (
									<Image
										src={doc.releaseSignature}
										style={{ height: 40, width: 160 }}
									/>
								)}
								<Text style={{ fontSize: 7, color: "#aaa" }}>
									{doc.warehouseName}
								</Text>
							</View>
							<View style={styles.sigBox}>
								<Text style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>
									Crew Receipt:
								</Text>
								{doc.crewSignature && (
									<Image
										src={doc.crewSignature}
										style={{ height: 40, width: 160 }}
									/>
								)}
								<Text style={{ fontSize: 7, color: "#aaa" }}>
									{doc.signedAt ? new Date(doc.signedAt).toLocaleString() : ""}
								</Text>
							</View>
						</View>
					</>
				)}

				{/* Photos count */}
				{doc.photos.length > 0 && (
					<>
						<Text style={styles.h2}>Field Photos</Text>
						<Text style={{ fontSize: 8, color: "#555" }}>
							{doc.photos.length} photo(s) attached to this job record. Stored
							on-premise server.
						</Text>
					</>
				)}

				{/* Audit trail */}
				<Text style={styles.h2}>Audit Trail</Text>
				{doc.auditTrail.map((entry) => (
					<View
						key={`${entry.timestamp.toISOString()}-${entry.action}`}
						style={{
							flexDirection: "row",
							gap: 8,
							marginBottom: 2,
							fontSize: 8,
						}}
					>
						<Text style={{ color: "#555", width: 100 }}>
							{new Date(entry.timestamp).toLocaleString()}
						</Text>
						<Text style={{ width: 100 }}>{entry.user.name}</Text>
						<Text style={{ color: "#333" }}>{entry.action}</Text>
					</View>
				))}
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

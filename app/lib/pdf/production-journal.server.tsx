import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import type { JournalBlock } from "~/lib/payroll-run.server"

const styles = StyleSheet.create({
	page: { padding: 24, fontFamily: "Helvetica", fontSize: 9 },
	title: { fontSize: 14, fontWeight: "bold", marginBottom: 4 },
	subtitle: { fontSize: 10, marginBottom: 12, color: "#555" },
	block: {
		marginBottom: 10,
		borderBottom: "0.5px solid #ccc",
		paddingBottom: 6,
	},
	blockHeader: { fontSize: 10, fontWeight: "bold", marginBottom: 4 },
	row: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 2,
	},
	label: { color: "#555" },
})

/**
 * Render the paper Production Journal Lissette closes a payroll run from.
 *
 * Reads only the amounts already frozen on the run's invoices, so the PDF is a
 * faithful copy of what was generated — a later `ServiceCode.unitPrice` change
 * cannot move these figures.
 */
export async function generateProductionJournalPdf(
	run: { label: string; generatedAt: Date },
	blocks: JournalBlock[],
): Promise<Buffer> {
	const doc = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<Text style={styles.title}>Production Journal — {run.label}</Text>
				<Text style={styles.subtitle}>
					Generated {run.generatedAt.toISOString().slice(0, 10)}
				</Text>
				{blocks.map((block) => (
					<View key={block.contractorAccountId} style={styles.block}>
						<Text style={styles.blockHeader}>
							{block.accountCode} · {block.contractorLabel}
							{block.winpayEmployeeCode
								? ` · ${block.winpayEmployeeCode}${block.isPlaceholder ? " (placeholder)" : ""}`
								: ""}
						</Text>
						<View style={styles.row}>
							<Text style={styles.label}>Gross</Text>
							<Text>${block.gross.toFixed(2)}</Text>
						</View>
						<View style={styles.row}>
							<Text style={styles.label}>Net</Text>
							<Text>${block.net.toFixed(2)}</Text>
						</View>
						<View style={styles.row}>
							<Text style={styles.label}>10% ret.</Text>
							<Text>${block.retention.toFixed(2)}</Text>
						</View>
						<View style={styles.row}>
							<Text style={styles.label}>Adj. net (running)</Text>
							<Text>${block.adjNetRunning.toFixed(2)}</Text>
						</View>
					</View>
				))}
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

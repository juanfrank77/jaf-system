import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import type {
	JournalBlock,
	JournalJob,
	JournalLine,
} from "~/lib/payroll-run.server"

const styles = StyleSheet.create({
	page: { padding: 24, fontFamily: "Helvetica", fontSize: 8 },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 8,
	},
	title: { fontSize: 12, fontWeight: "bold" },
	period: { fontSize: 8, color: "#555" },
	brigadeHeader: {
		fontSize: 9,
		fontWeight: "bold",
		marginTop: 8,
		marginBottom: 4,
	},
	jobHeader: {
		fontSize: 8,
		fontWeight: "bold",
		marginBottom: 2,
		color: "#333",
	},
	tableHeader: {
		flexDirection: "row",
		borderBottom: "0.5px solid #666",
		fontSize: 7,
		textTransform: "uppercase",
		letterSpacing: 0.3,
	},
	row: { flexDirection: "row", fontSize: 7 },
	subTotalRow: {
		flexDirection: "row",
		fontWeight: "bold",
		borderTop: "0.5px solid #999",
		fontSize: 7,
	},
	totalScRow: {
		flexDirection: "row",
		fontWeight: "bold",
		borderTop: "1px solid #333",
		borderBottom: "0.5px solid #333",
		fontSize: 7,
	},
	grandTotalRow: {
		flexDirection: "row",
		fontWeight: "bold",
		borderTop: "1px solid #333",
		fontSize: 7,
	},
	cell: { paddingHorizontal: 1, paddingVertical: 0.5 },
	cellRight: {
		...({ paddingHorizontal: 1, paddingVertical: 0.5 } as const),
		textAlign: "right",
	},
	labelCell: { paddingHorizontal: 1, paddingVertical: 0.5, width: 200 },
	muted: { color: "#555" },
	footer: { marginTop: 12, fontSize: 6, color: "#777", textAlign: "center" },
})

const COL = {
	assoc: 55,
	desc: 165,
	qty: 30,
	unitPrice: 45,
	gross: 45,
	net: 45,
	pctRet: 35,
	ret10: 45,
	adjNet: 55,
} as const

function fmt(n: number): string {
	return n.toFixed(2)
}

function fmtRunning(n: number): string {
	return n.toFixed(2)
}

function ServiceLine({ line }: { line: JournalLine }) {
	return (
		<View style={styles.row}>
			<Text style={[styles.cell, { width: COL.assoc }]}>{line.claroCode}</Text>
			<Text style={[styles.cell, { width: COL.desc }]}>{line.description}</Text>
			<Text style={[styles.cell, { width: COL.qty, textAlign: "right" }]}>
				{fmt(line.qty)}
			</Text>
			<Text style={[styles.cell, { width: COL.unitPrice, textAlign: "right" }]}>
				{fmt(line.unitPrice)}
			</Text>
			<Text style={[styles.cell, { width: COL.gross, textAlign: "right" }]}>
				{fmt(line.gross)}
			</Text>
			<Text style={[styles.cell, { width: COL.net, textAlign: "right" }]}>
				{fmt(line.net)}
			</Text>
			<Text style={[styles.cell, { width: COL.pctRet, textAlign: "right" }]}>
				{fmt(line.pctRet)}
			</Text>
			<Text style={[styles.cell, { width: COL.ret10, textAlign: "right" }]}>
				{fmt(line.retention)}
			</Text>
			<Text style={[styles.cell, { width: COL.adjNet, textAlign: "right" }]}>
				{fmt(line.adjNet)}
			</Text>
		</View>
	)
}

function JobBlock({ job }: { job: JournalJob }) {
	return (
		<View>
			<Text style={styles.jobHeader}>
				{job.controlNumber}
				{job.avisoNumber ? ` · Aviso ${job.avisoNumber}` : ""}
			</Text>
			{job.lines.map((line) => (
				<ServiceLine key={line.claroCode} line={line} />
			))}
			<View style={styles.subTotalRow}>
				<Text style={[styles.cell, { width: COL.assoc + COL.desc }]}>
					Sub Total
				</Text>
				<Text style={[styles.cell, { width: COL.qty, textAlign: "right" }]}>
					{job.lines.length}
				</Text>
				<Text
					style={[styles.cell, { width: COL.unitPrice, textAlign: "right" }]}
				>
					—
				</Text>
				<Text style={[styles.cell, { width: COL.gross, textAlign: "right" }]}>
					{fmt(job.gross)}
				</Text>
				<Text style={[styles.cell, { width: COL.net, textAlign: "right" }]}>
					{fmt(job.net)}
				</Text>
				<Text style={[styles.cell, { width: COL.pctRet, textAlign: "right" }]}>
					{fmt(0)}
				</Text>
				<Text style={[styles.cell, { width: COL.ret10, textAlign: "right" }]}>
					{fmt(job.retention)}
				</Text>
				<Text style={[styles.cell, { width: COL.adjNet, textAlign: "right" }]}>
					{fmtRunning(job.adjNetRunning)}
				</Text>
			</View>
		</View>
	)
}

function BrigadeBlock({ block }: { block: JournalBlock }) {
	const grandTotal = (b: JournalBlock) => ({
		gross: b.gross,
		net: b.net,
		retention: b.retention,
		adjNet: b.totalSC,
	})
	const gt = grandTotal(block)
	return (
		<View key={block.brigadeCode}>
			<Text style={styles.brigadeHeader}>
				{block.brigadeCode} — {block.brigadeLabel}
			</Text>
			{block.jobs.map((job) => (
				<JobBlock key={job.invoiceId} job={job} />
			))}
			<View style={styles.totalScRow}>
				<Text style={[styles.cell, { width: COL.assoc + COL.desc }]}>
					Total SC {block.brigadeCode}
				</Text>
				<Text style={[styles.cell, { width: COL.qty, textAlign: "right" }]}>
					—
				</Text>
				<Text
					style={[styles.cell, { width: COL.unitPrice, textAlign: "right" }]}
				>
					—
				</Text>
				<Text style={[styles.cell, { width: COL.gross, textAlign: "right" }]}>
					{fmt(gt.gross)}
				</Text>
				<Text style={[styles.cell, { width: COL.net, textAlign: "right" }]}>
					{fmt(gt.net)}
				</Text>
				<Text style={[styles.cell, { width: COL.pctRet, textAlign: "right" }]}>
					{fmt(0)}
				</Text>
				<Text style={[styles.cell, { width: COL.ret10, textAlign: "right" }]}>
					{fmt(gt.retention)}
				</Text>
				<Text style={[styles.cell, { width: COL.adjNet, textAlign: "right" }]}>
					{fmt(gt.adjNet)}
				</Text>
			</View>
		</View>
	)
}

function GrandTotal({ blocks }: { blocks: JournalBlock[] }) {
	const gt = blocks.reduce(
		(acc, b) => ({
			gross: acc.gross + b.gross,
			net: acc.net + b.net,
			retention: acc.retention + b.retention,
			adjNet: acc.adjNet + b.totalSC,
		}),
		{ gross: 0, net: 0, retention: 0, adjNet: 0 },
	)
	return (
		<View style={styles.grandTotalRow}>
			<Text style={[styles.cell, { width: COL.assoc + COL.desc }]}>
				Grand Total
			</Text>
			<Text style={[styles.cell, { width: COL.qty, textAlign: "right" }]}>
				—
			</Text>
			<Text style={[styles.cell, { width: COL.unitPrice, textAlign: "right" }]}>
				—
			</Text>
			<Text style={[styles.cell, { width: COL.gross, textAlign: "right" }]}>
				{fmt(gt.gross)}
			</Text>
			<Text style={[styles.cell, { width: COL.net, textAlign: "right" }]}>
				{fmt(gt.net)}
			</Text>
			<Text style={[styles.cell, { width: COL.pctRet, textAlign: "right" }]}>
				—
			</Text>
			<Text style={[styles.cell, { width: COL.ret10, textAlign: "right" }]}>
				{fmt(gt.retention)}
			</Text>
			<Text style={[styles.cell, { width: COL.adjNet, textAlign: "right" }]}>
				{fmt(gt.adjNet)}
			</Text>
		</View>
	)
}

/**
 * Render the paper Production Journal Lissette closes a payroll run from.
 *
 * Structure per docs/JAF_Finance_answer_Journey.pdf Part 1 § "How the report is built":
 *   Brigade block → job block → one row per service line
 *   Columns: ASSOC · DESCIPCIÓN · QTY · U.P. · GROSS · NET (65%) · Pct RET. · 10% RET. · ADJ. NET
 *
 * Reads only the amounts already frozen on the run's invoices via
 * `contractorShareLines`, so the PDF is a faithful copy of what was generated —
 * a later `ServiceCode.unitPrice` change cannot move these figures.
 */
export async function generateProductionJournalPdf(
	run: { label: string; generatedAt: Date },
	blocks: JournalBlock[],
): Promise<Buffer> {
	const date = run.generatedAt.toISOString().slice(0, 10)
	const doc = (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<View style={styles.header}>
					<Text style={styles.title}>Production Journal — {run.label}</Text>
					<Text style={styles.period}>Generated {date}</Text>
				</View>

				<Text style={styles.muted}>
					This run: {blocks.length} brigades,{" "}
					{blocks.reduce((s, b) => s + b.jobs.length, 0)} jobs
				</Text>

				{blocks.map((block) => (
					<BrigadeBlock key={block.brigadeCode} block={block} />
				))}

				<GrandTotal blocks={blocks} />

				<Text style={styles.footer}>
					Production Journal — generated by the JAF Ops system. This document is
					the reconciliation source for payroll.
				</Text>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

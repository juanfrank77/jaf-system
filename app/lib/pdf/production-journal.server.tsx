import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { shareFigures } from "~/lib/contractor-share"
import type { JournalBlock } from "~/lib/payroll-run.server"

const styles = StyleSheet.create({
	page: {
		paddingTop: 28,
		paddingBottom: 32,
		paddingHorizontal: 30,
		fontFamily: "Courier",
		fontSize: 8,
	},
	pageHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 6,
	},
	title: { fontFamily: "Courier-Bold", textAlign: "center", flexGrow: 1 },
	brigade: { fontFamily: "Courier-Bold", marginTop: 4, marginBottom: 4 },
	columns: {
		flexDirection: "row",
		borderBottom: "0.75px solid #000",
		marginBottom: 3,
	},
	row: { flexDirection: "row" },
	bold: { fontFamily: "Courier-Bold" },
	subTotal: { flexDirection: "row", marginTop: 2, marginBottom: 6 },
	totalRow: {
		flexDirection: "row",
		borderTop: "0.75px solid #000",
		marginTop: 4,
		fontFamily: "Courier-Bold",
	},
	reportTotals: { marginTop: 40, fontFamily: "Courier-Bold" },
})

// Column widths in points. ASSOC/description share the left block.
const W = {
	assoc: 250,
	qty: 40,
	unit: 62,
	gross: 72,
	net: 72,
	pct: 56,
	ret: 66,
	adj: 80,
} as const

const money = (n: number) =>
	n.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})

const printDate = (d: Date) => {
	const mm = String(d.getMonth() + 1).padStart(2, "0")
	const dd = String(d.getDate()).padStart(2, "0")
	return `${mm}/${dd}/${String(d.getFullYear()).slice(2)}`
}

export type JournalOptions = {
	/**
	 * Print the JAF Unit Price and Gross columns. The brigade copy leaves them
	 * blank (the columns stay in place); Lissette's copy shows them.
	 */
	showPrices: boolean
	/** Prefix of the PBCC invoice number: "M17" + the Aviso #. */
	invoicePrefix?: string
	printedAt?: Date
}

function Cell({
	w,
	children,
	right = true,
}: {
	w: number
	children?: React.ReactNode
	right?: boolean
}) {
	return (
		<Text style={{ width: w, textAlign: right ? "right" : "left" }}>
			{children}
		</Text>
	)
}

/**
 * The Production Journal as Lissette prints it today: US Letter landscape,
 * Courier, one brigade per page run, jobs in job # order with their service
 * lines, a Sub Total per job, a Total SC per brigade and the report totals
 * alone on the last page. Every figure comes from `buildJournalBlocks`, which
 * truncates each level from its own gross, so columns need not add up.
 */
export async function generateProductionJournalPdf(
	run: { label: string },
	blocks: JournalBlock[],
	opts: JournalOptions,
): Promise<Buffer> {
	const prefix = opts.invoicePrefix ?? "M17"
	const date = printDate(opts.printedAt ?? new Date())
	const money0 = (n: number) => (opts.showPrices ? money(n) : "")
	const allGross = blocks.reduce((s, b) => s + b.gross, 0)
	// The report totals take the grand gross at the first block's rate, as the
	// old report does; D blocks add their own share on top.
	const totals = blocks.reduce(
		(acc, b) => {
			const f = shareFigures(b.gross, b.percent)
			return {
				net: acc.net + f.net,
				ret: acc.ret + f.retention,
				adj: acc.adj + f.adjNet,
			}
		},
		{ net: 0, ret: 0, adj: 0 },
	)
	const hasD = blocks.some((b) => b.percent !== 65)
	const all = shareFigures(allGross, 65)
	const grand = hasD
		? totals
		: { net: all.net, ret: all.retention, adj: all.adjNet }

	const header = (
		<View style={styles.pageHeader} fixed>
			<Text>{date}</Text>
			<Text>JAF Communications, Inc.</Text>
			<Text render={({ pageNumber }) => `page ${pageNumber}`} />
		</View>
	)
	const title = (
		<View style={{ flexDirection: "row" }} fixed>
			<Text style={styles.title}>PRODUCTION JOURNAL</Text>
		</View>
	)

	const doc = (
		<Document>
			{blocks.map((b) => (
				<Page
					key={b.brigadeCode}
					size="LETTER"
					orientation="landscape"
					style={styles.page}
				>
					{header}
					{title}
					<Text style={styles.brigade}>
						{b.brigadeCode} {b.brigadeLabel.toUpperCase()} Acct. ID:
					</Text>
					<View style={styles.columns}>
						<Cell w={W.assoc} right={false}>
							ASSOC DESCRIPTION
						</Cell>
						<Cell w={W.qty}>QTY.</Cell>
						<Cell w={W.unit}>UNIT PRICE</Cell>
						<Cell w={W.gross}>GROSS AMOUNT</Cell>
						<Cell w={W.net}>NET AMOUNT</Cell>
						<Cell w={W.pct}>Pct. RET.</Cell>
						<Cell w={W.ret}>10% RET.</Cell>
						<Cell w={W.adj}>ADJ. NET AMOUNT</Cell>
					</View>
					{b.jobs.map((j) => (
						<View key={`${j.invoiceId}-${j.lines[0]?.percent}`}>
							<View style={[styles.row, styles.bold]} wrap={false}>
								<Cell w={W.assoc + W.qty} right={false}>
									{j.jobSeq == null ? j.controlNumber : `M-${j.jobSeq}`}{" "}
									{j.avisoNumber ? `${prefix}${j.avisoNumber}` : ""}
								</Cell>
							</View>
							{j.lines.map((l, i) => (
								<View
									// biome-ignore lint/suspicious/noArrayIndexKey: a job may repeat a service code, and lines have no id
									key={`${l.claroCode}-${i}`}
									style={styles.row}
									wrap={false}
								>
									<Cell w={W.assoc} right={false}>
										{l.claroCode} {l.description}
									</Cell>
									<Cell w={W.qty}>{Math.round(l.qty)}</Cell>
									<Cell w={W.unit}>{money0(l.unitPrice)}</Cell>
									<Cell w={W.gross}>{money0(l.gross)}</Cell>
									<Cell w={W.net}>{money(l.net)}</Cell>
									<Cell w={W.pct}>{money(l.pctRet)}</Cell>
									<Cell w={W.ret}>{money(l.retention)}</Cell>
									<Cell w={W.adj}>{money(l.adjNet)}</Cell>
								</View>
							))}
							<View style={styles.subTotal} wrap={false}>
								<Cell w={W.assoc + W.qty + W.unit} right={false}>
									Sub Total
								</Cell>
								<Cell w={W.gross}>{money0(j.gross)}</Cell>
								<Cell w={W.net}>{money(j.net)}</Cell>
								<Cell w={W.pct}>{money(0)}</Cell>
								<Cell w={W.ret}>{money(j.retention)}</Cell>
								<Cell w={W.adj}>{money(j.adjNetRunning)}</Cell>
							</View>
						</View>
					))}
					<View style={styles.totalRow} wrap={false}>
						<Cell w={W.assoc + W.qty + W.unit} right={false}>
							Total SC
						</Cell>
						<Cell w={W.gross}>{money0(b.gross)}</Cell>
						<Cell w={W.net}>{money(b.net)}</Cell>
						<Cell w={W.pct}>{money(0)}</Cell>
						<Cell w={W.ret}>{money(b.retention)}</Cell>
						<Cell w={W.adj}>{money(b.totalSC)}</Cell>
					</View>
				</Page>
			))}
			<Page size="LETTER" orientation="landscape" style={styles.page}>
				<Text>{run.label}</Text>
				<View style={styles.reportTotals}>
					<Text>Totals: Gross Amt. {money0(allGross) || "-"}</Text>
					<Text>Net Amt. {money(grand.net)}</Text>
					<Text>Ret. {money(0)}</Text>
					<Text>10% Ret. {money(grand.ret)}</Text>
					<Text>Adj. Net Amount {money(grand.adj)}</Text>
				</View>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

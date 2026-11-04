import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { getDocumentProxy } from "unpdf"
import { bankInvoiceNumber } from "~/lib/bank-schedule"
import { displayRequestLabel } from "~/lib/payroll-request-view"
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
	 * Print the JAF Unit Price and Gross columns. The brigade copy prints 0.00
	 * in them (the columns stay in place); Lissette's copy shows them.
	 */
	showPrices: boolean
	/** Prefix of the PBCC invoice number: "M17" + "-" + the Aviso #. */
	invoicePrefix?: string
	/** The request's pay date, printed in every page header when known. */
	payDate?: Date | null
	/** Put the report totals row under the last brigade (default: unless a partial print). */
	withTotals?: boolean
	printedAt?: Date
	/** Print only these brigades' pages (their codes, "009D" for D lines) and no report totals. */
	onlyBrigades?: string[]
	/** Carmen's copy: "Carmen's copy · sent by Lissette 10/28/26 8:12 am", then " · page x of y" on every page. */
	footer?: string
}

const pageFooter = (footer: string | undefined) =>
	footer ? (
		<Text
			fixed
			style={{ position: "absolute", bottom: 14, left: 30, fontSize: 7 }}
			render={({ pageNumber, totalPages }) =>
				`${footer} · page ${pageNumber} of ${totalPages}`
			}
		/>
	) : null

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
	const all_ = blocks
	if (opts.onlyBrigades) {
		const keep = new Set(opts.onlyBrigades)
		blocks = blocks.filter((b) => keep.has(b.brigadeCode))
	}
	const withTotals = opts.withTotals ?? !opts.onlyBrigades
	const date = printDate(opts.printedAt ?? new Date())
	// Lissette's rule: Gross is the JAF total, so the brigade copy prints 0.00 in
	// its place (like Unit Price). Net is already computed from the real gross.
	const money0 = (n: number) => money(opts.showPrices ? n : 0)
	const allGross = all_.reduce((s, b) => s + b.gross, 0)
	// The grand total is the brigades' Total SC rows added up, to the cent.
	const sumCents = (pick: (b: JournalBlock) => number) =>
		all_.reduce((s, b) => s + Math.round(pick(b) * 100), 0) / 100
	const grand = {
		net: sumCents((b) => b.net),
		ret: sumCents((b) => b.retention),
		adj: sumCents((b) => b.totalSC),
	}
	const request = [
		displayRequestLabel(run.label),
		opts.payDate ? `Pay date ${printDate(opts.payDate)}` : "",
	]
		.filter(Boolean)
		.join(" · ")

	const header = (
		<View style={styles.pageHeader} fixed>
			<Text>{date}</Text>
			<Text>JAF Communications, Inc.</Text>
			<View style={{ alignItems: "flex-end" }}>
				<Text>{request}</Text>
				<Text render={({ pageNumber }) => `page ${pageNumber}`} />
			</View>
		</View>
	)
	const title = (
		<View style={{ flexDirection: "row" }} fixed>
			<Text style={styles.title}>PRODUCTION JOURNAL</Text>
		</View>
	)
	// The report totals, lined up with the columns, right after the last Total SC.
	const grandTotals = (
		<View style={[styles.totalRow, { marginTop: 14 }]} wrap={false}>
			<Cell w={W.assoc + W.qty + W.unit} right={false}>
				Totals
			</Cell>
			<Cell w={W.gross}>{money0(allGross)}</Cell>
			<Cell w={W.net}>{money(grand.net)}</Cell>
			<Cell w={W.pct}>{money(0)}</Cell>
			<Cell w={W.ret}>{money(grand.ret)}</Cell>
			<Cell w={W.adj}>{money(grand.adj)}</Cell>
		</View>
	)

	const doc = (
		<Document>
			{blocks.map((b, i) => (
				<Page
					key={b.brigadeCode}
					size="LETTER"
					orientation="landscape"
					style={styles.page}
				>
					{header}
					{pageFooter(opts.footer)}
					{title}
					<Text style={styles.brigade}>
						{b.brigadeCode} {b.brigadeLabel.toUpperCase()} Acct. ID:{" "}
						{b.acctId ?? ""}
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
									{j.avisoNumber
										? bankInvoiceNumber(prefix, j.avisoNumber)
										: ""}
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
					{withTotals && i === blocks.length - 1 && grandTotals}
				</Page>
			))}
			{withTotals && blocks.length === 0 && (
				<Page size="LETTER" orientation="landscape" style={styles.page}>
					{header}
					{pageFooter(opts.footer)}
					{title}
					{grandTotals}
				</Page>
			)}
		</Document>
	)
	return renderToBuffer(doc)
}

async function pageCount(bytes: Buffer): Promise<number> {
	const pdf = await getDocumentProxy(new Uint8Array(bytes))
	return pdf.numPages
}

export type JournalOutline = {
	/** Pages of the whole packet: every brigade, the report totals under the last. */
	totalPages: number
	brigades: {
		code: string
		label: string
		jobs: number
		adjNet: number
		startPage: number
		pages: number
	}[]
}

/**
 * Where each brigade starts in the whole packet, for the viewer's "jump to
 * brigade" and the print choices' page counts. A brigade's page run is found by
 * rendering it on its own; the packet is those runs in order plus the totals.
 */
export async function journalOutline(
	run: { label: string },
	blocks: JournalBlock[],
	opts: JournalOptions,
): Promise<JournalOutline> {
	const brigades: JournalOutline["brigades"] = []
	let next = 1
	for (const [i, b] of blocks.entries()) {
		// The report totals ride on the last brigade's page run, so count them there.
		const pages = await pageCount(
			await generateProductionJournalPdf(run, blocks, {
				...opts,
				footer: undefined,
				onlyBrigades: [b.brigadeCode],
				withTotals: i === blocks.length - 1,
			}),
		)
		brigades.push({
			code: b.brigadeCode,
			label: b.brigadeLabel,
			jobs: b.jobs.length,
			adjNet: b.totalSC,
			startPage: next,
			pages,
		})
		next += pages
	}
	return { totalPages: Math.max(1, next - 1), brigades }
}

/** The one-page brigade list: who is on the packet, what each is owed and where to find it. */
export async function generatePacketSummaryPdf(
	run: { label: string },
	outline: JournalOutline,
	opts: { footer?: string; printedAt?: Date },
): Promise<Buffer> {
	const total = outline.brigades.reduce((s, b) => s + b.adjNet, 0)
	const doc = (
		<Document>
			<Page size="LETTER" orientation="landscape" style={styles.page}>
				<View style={styles.pageHeader} fixed>
					<Text>{printDate(opts.printedAt ?? new Date())}</Text>
					<Text>JAF Communications, Inc.</Text>
					<Text />
				</View>
				{pageFooter(opts.footer)}
				<Text style={styles.title}>PAYROLL PACKET SUMMARY</Text>
				<Text style={styles.brigade}>{run.label}</Text>
				<View style={styles.columns}>
					<Cell w={60} right={false}>
						ACCT
					</Cell>
					<Cell w={260} right={false}>
						BRIGADE
					</Cell>
					<Cell w={50}>JOBS</Cell>
					<Cell w={110}>ADJ. NET AMOUNT</Cell>
					<Cell w={60}>PAGE</Cell>
				</View>
				{outline.brigades.map((b) => (
					<View key={b.code} style={styles.row} wrap={false}>
						<Cell w={60} right={false}>
							{b.code}
						</Cell>
						<Cell w={260} right={false}>
							{b.label.toUpperCase()}
						</Cell>
						<Cell w={50}>{b.jobs}</Cell>
						<Cell w={110}>{money(b.adjNet)}</Cell>
						<Cell w={60}>{b.startPage}</Cell>
					</View>
				))}
				<View style={styles.totalRow} wrap={false}>
					<Cell w={320} right={false}>
						Total
					</Cell>
					<Cell w={50}>{outline.brigades.reduce((s, b) => s + b.jobs, 0)}</Cell>
					<Cell w={110}>{money(total)}</Cell>
				</View>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

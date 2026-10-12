import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import type { JobKind } from "~/lib/bank-schedule"

const styles = StyleSheet.create({
	page: { padding: 28, fontFamily: "Helvetica", fontSize: 8 },
	company: { fontSize: 11, fontWeight: "bold" },
	small: { fontSize: 7, color: "#444" },
	titleBox: { alignItems: "center" },
	title: { fontSize: 10, fontWeight: "bold" },
	topRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 8,
	},
	box: { borderWidth: 1, borderColor: "#000", marginBottom: 6 },
	boxRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
	cell: { padding: 4, borderRightWidth: 1, borderColor: "#000", flex: 1 },
	cellLast: { padding: 4, flex: 1 },
	label: { fontSize: 7, color: "#555" },
	bold: { fontWeight: "bold" },
	check: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
	checkBox: {
		width: 8,
		height: 8,
		borderWidth: 1,
		borderColor: "#000",
		marginRight: 4,
		alignItems: "center",
		justifyContent: "center",
	},
	th: {
		flexDirection: "row",
		borderTopWidth: 1,
		borderBottomWidth: 1,
		borderColor: "#000",
		paddingVertical: 3,
		fontSize: 7,
		fontWeight: "bold",
	},
	tr: { flexDirection: "row", paddingVertical: 2 },
	cCode: { width: 50 },
	cDesc: { flex: 1 },
	cQty: { width: 34, textAlign: "right" },
	cUm: { width: 24, textAlign: "center" },
	cPrice: { width: 48, textAlign: "right" },
	cAmt: { width: 52, textAlign: "right" },
	cAc: { width: 30, textAlign: "center" },
	cSub: { width: 30, textAlign: "center" },
	cDept: { width: 30, textAlign: "center" },
	cProfit: { width: 36, textAlign: "center" },
	cAct: { width: 26, textAlign: "center" },
	cCenter: { width: 36, textAlign: "center" },
	totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
	sign: { marginTop: 60 },
})

export type BankInvoiceLine = {
	claroCode: string
	description: string
	qty: number
	unit: string
	unitPrice: number
	amount: number
	accountCode: string
	subAct: string
	dept: string
	profitCenter: string
	act: string
	costCenter: string
}

export type BankInvoiceInput = {
	supplierNumber: string
	invoiceNumber: string
	contractLabel: string
	workFrom: string
	workTo: string
	description: string
	locality: string
	kind: JobKind
	lines: BankInvoiceLine[]
	total: number
}

const money = (n: number) => n.toFixed(2)

function Check({ on, label }: { on: boolean; label: string }) {
	return (
		<View style={styles.check}>
			<View style={styles.checkBox}>{on ? <Text>X</Text> : null}</View>
			<Text>{label}</Text>
		</View>
	)
}

function BankInvoice({ input }: { input: BankInvoiceInput }) {
	return (
		<Document>
			<Page size="LETTER" style={styles.page}>
				<View style={styles.topRow}>
					<View>
						<Text style={styles.company}>JAF Communications, Inc.</Text>
						<Text style={styles.small}>
							PO Box 11468, CAPARRA HEIGHTS, PR 00922
						</Text>
					</View>
					<View style={styles.titleBox}>
						<Text style={styles.title}>ACTA DE CONFORMIDAD</Text>
						<Text style={styles.small}>
							Contrato Núm. {input.contractLabel}
						</Text>
						<Text style={styles.title}>FACTURA / CERTIFICACION</Text>
						<Text style={styles.title}>DE CONTRATISTA A P.R.T.</Text>
					</View>
				</View>

				<View style={styles.box}>
					<View style={styles.boxRow}>
						<View style={styles.cell}>
							<Text style={styles.label}>NUMERO SUPLIDOR</Text>
							<Text style={styles.bold}>{input.supplierNumber}</Text>
						</View>
						<View style={styles.cell}>
							<Text style={styles.label}>NUMERO DE FACTURA</Text>
							<Text style={styles.bold}>{input.invoiceNumber}</Text>
						</View>
						<View style={styles.cellLast}>
							<Text style={styles.label}>TRABAJO EFECTUADO ENTRE</Text>
							<Text style={styles.bold}>
								{input.workFrom} {input.workTo}
							</Text>
						</View>
					</View>
					<View style={styles.boxRow}>
						<View style={styles.cell}>
							<Text style={styles.label}>DESCRIPCION DEL TRABAJO</Text>
							<Text>{input.description}</Text>
							<Text style={styles.label}>Localidad:</Text>
							<Text style={styles.bold}>{input.locality}</Text>
						</View>
						<View style={styles.cell}>
							<Check on={input.kind === "INSTALACION"} label="INSTALACION" />
							<Check on={input.kind === "CONSTRUCCION"} label="CONSTRUCCION" />
							<Check
								on={input.kind === "MANTENIMIENTO"}
								label="MANTENIMIENTO"
							/>
						</View>
						<View style={styles.cellLast}>
							<Text style={styles.label}>TOTAL A PAGAR $</Text>
							<Text style={styles.bold}>{money(input.total)}</Text>
						</View>
					</View>
				</View>

				<View style={styles.th}>
					<Text style={styles.cCode}>No. de Servicio</Text>
					<Text style={styles.cDesc}>DESCRIPCION</Text>
					<Text style={styles.cQty}>CANTIDAD</Text>
					<Text style={styles.cUm}>U/M</Text>
					<Text style={styles.cPrice}>P. UNITARIO</Text>
					<Text style={styles.cAmt}>IMPORTE</Text>
					<Text style={styles.cAc}>A/C</Text>
					<Text style={styles.cSub}>SUB ACT</Text>
					<Text style={styles.cDept}>DEPT.</Text>
					<Text style={styles.cProfit}>PROFIT C.</Text>
					<Text style={styles.cAct}>ACT</Text>
					<Text style={styles.cCenter}>CENTRO</Text>
				</View>
				{input.lines.map((l) => (
					<View key={l.claroCode} style={styles.tr} wrap={false}>
						<Text style={styles.cCode}>{l.claroCode}</Text>
						<Text style={styles.cDesc}>{l.description}</Text>
						<Text style={styles.cQty}>{l.qty.toFixed(2)}</Text>
						<Text style={styles.cUm}>{l.unit}</Text>
						<Text style={styles.cPrice}>{money(l.unitPrice)}</Text>
						<Text style={styles.cAmt}>{money(l.amount)}</Text>
						<Text style={styles.cAc}>{l.accountCode}</Text>
						<Text style={styles.cSub}>{l.subAct}</Text>
						<Text style={styles.cDept}>{l.dept}</Text>
						<Text style={styles.cProfit}>{l.profitCenter}</Text>
						<Text style={styles.cAct}>{l.act}</Text>
						<Text style={styles.cCenter}>{l.costCenter}</Text>
					</View>
				))}
				<View style={styles.totalRow}>
					<Text style={styles.bold}>Total $ {money(input.total)}</Text>
				</View>
				<View style={styles.sign}>
					<Text>Firma: ______________________</Text>
				</View>
			</Page>
		</Document>
	)
}

export async function generateBankInvoicePdf(
	input: BankInvoiceInput,
): Promise<Buffer> {
	return renderToBuffer(<BankInvoice input={input} />)
}

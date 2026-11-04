import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import type { ComponentProps, ReactNode } from "react"
import type { JobKind } from "~/lib/bank-schedule"

type Style = Exclude<
	NonNullable<ComponentProps<typeof View>["style"]>,
	readonly unknown[]
>

/*
 * PBCC "Acta de Conformidad / Factura - Certificacion de Contratista a P.R.T."
 * laid out after JAF's real sample (docs/JAF_Package/04 Sample Documents by
 * Entity/Finance Journey Example (single Aviso)/4. . PBCC Invoice.pdf): US
 * Letter LANDSCAPE, a fixed-form header and main box (positioned absolutely,
 * coordinates in points measured off the sample), then the service-line table
 * in normal flow, whose header row repeats on every page.
 */

/** Width of the main box and the line table (the sample's 711pt form). */
const W = 711
/** Main box height and its column / row rules, in points from its top-left. */
const BOX_H = 190
const X_FACT = 181 // left column | NUMERO DE FACTURA
const X_ORG = 319 // NUMERO DE FACTURA | ORG.
const X_FECHA = 355 // ORG. | FECHA
const X_SIGN = 418 // FECHA | signature block
const Y_LABELS = 21
const Y_VALUES = 45
const Y_PO_LABEL = 64
const Y_WORK = 80
const Y_SIGN_END = 140.5
const Y_TOTAL = 156.5

const styles = StyleSheet.create({
	page: {
		paddingTop: 4,
		paddingLeft: 10,
		paddingRight: 71,
		paddingBottom: 24,
		fontFamily: "Helvetica",
		fontSize: 8.5,
	},
	header: { position: "relative", height: 31, width: W },
	box: { position: "relative", height: BOX_H, width: W },
	bold: { fontWeight: "bold" },
	th: {
		flexDirection: "row",
		width: W,
		borderTopWidth: 1,
		borderBottomWidth: 1,
		borderLeftWidth: 1,
		borderColor: "#000",
		height: 28,
		fontSize: 6.5,
	},
	thCell: {
		borderRightWidth: 1,
		borderColor: "#000",
		justifyContent: "center",
		textAlign: "center",
	},
	tr: { flexDirection: "row", width: W, paddingTop: 2, fontSize: 8 },
	check: {
		position: "absolute",
		left: 338,
		flexDirection: "row",
		alignItems: "center",
	},
	checkBox: {
		width: 10,
		height: 10,
		borderWidth: 1,
		borderColor: "#000",
		marginRight: 7,
		alignItems: "center",
		justifyContent: "center",
	},
	dateBox: {
		flexDirection: "row",
		width: 63,
		height: 9,
		borderWidth: 1,
		borderColor: "#000",
	},
})

/** Line-table columns: [header lines, width, alignment of the data cells]. */
const COLS = [
	{ head: ["No. de", "Servicio"], w: 47, align: "left" },
	{ head: ["DESCRIPCION"], w: 190, align: "left" },
	{ head: ["CANTIDAD"], w: 43, align: "right" },
	{ head: ["U/M"], w: 19, align: "center" },
	{ head: ["PRECIO", "UNITARIO"], w: 66, align: "right" },
	{ head: ["IMPORTE"], w: 77, align: "right" },
	{ head: ["A/C"], w: 46, align: "center" },
	{ head: ["SUB ACT"], w: 40, align: "center" },
	{ head: ["DEPT."], w: 30, align: "center" },
	{ head: ["PROFIT CENTER"], w: 58, align: "center" },
	{ head: ["ACT"], w: 17, align: "center" },
	{ head: ["CENTRO", "CODIGO COSTO"], w: 78, align: "center" },
] as const

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
	/** Printed in NUMERO DE FACTURA: the bank invoice number, "M17-" + the aviso #. */
	avisoNumber: string
	/** JAF's own job # (M-3545 style). JAF OS has none yet, so it prints blank. */
	jobNumber?: string
	/** ORG. cell (PWOR). */
	org: string
	/** FECHA: the invoice date, MM/DD/YY in the Puerto Rico calendar. */
	invoiceDate: string
	contractLabel: string
	/** The job's own start and finish, MM/DD/YY; blank when the job has none. */
	workFrom: string
	workTo: string
	/** DESCRIPCION DEL TRABAJO: the job description, then an optional barrio. */
	description: string
	barrio?: string
	locality: string
	kind: JobKind
	lines: BankInvoiceLine[]
	total: number
}

const money = (n: number) => n.toFixed(2)
const unitPriceText = (n: number) =>
	n.toFixed(3).endsWith("0") ? n.toFixed(2) : n.toFixed(3)

/** Text placed at (left, top) inside the enclosing relative box. */
function At({
	left,
	top,
	width,
	align,
	style,
	children,
}: {
	left: number
	top: number
	width?: number
	align?: "left" | "center" | "right"
	style?: Style | Style[]
	children: ReactNode
}) {
	const extra = style ? ([] as Style[]).concat(style) : []
	return (
		<Text
			style={[
				{
					position: "absolute",
					left,
					top,
					...(width != null ? { width } : {}),
					...(align ? { textAlign: align } : {}),
				},
				...extra,
			]}
		>
			{children}
		</Text>
	)
}

/** A 1pt black rule: horizontal when `w` is given, vertical when `h` is. */
function Rule({
	x,
	y,
	w,
	h,
}: {
	x: number
	y: number
	w?: number
	h?: number
}) {
	return (
		<View
			style={{
				position: "absolute",
				left: x,
				top: y,
				...(w != null
					? { width: w, borderTopWidth: 1 }
					: { height: h, borderLeftWidth: 1 }),
				borderColor: "#000",
			}}
		/>
	)
}

function Check({
	on,
	label,
	top,
}: {
	on: boolean
	label: string
	top: number
}) {
	return (
		<View style={[styles.check, { top }]}>
			<View style={styles.checkBox}>
				{on ? (
					<Text style={[styles.bold, { fontSize: 8, lineHeight: 1 }]}>X</Text>
				) : null}
			</View>
			<Text style={{ fontSize: 7 }}>{label}</Text>
		</View>
	)
}

function SignRow({ label, top }: { label: string; top: number }) {
	return (
		<View
			style={{
				position: "absolute",
				left: X_SIGN + 6,
				top,
				width: W - X_SIGN - 9,
				flexDirection: "row",
				alignItems: "flex-end",
			}}
		>
			<Text style={{ width: 68 }}>{label}</Text>
			<View style={{ width: 128, borderBottomWidth: 1, borderColor: "#000" }} />
			<Text style={{ width: 31 }}>FECHA:</Text>
			<View style={styles.dateBox}>
				<View style={{ flex: 1, borderRightWidth: 1, borderColor: "#000" }} />
				<View style={{ flex: 1, borderRightWidth: 1, borderColor: "#000" }} />
				<View style={{ flex: 1 }} />
			</View>
		</View>
	)
}

function MainBox({ input }: { input: BankInvoiceInput }) {
	const mid = X_FACT + 5
	return (
		<View style={styles.box}>
			{/* Outer frame and rules */}
			<View
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					width: W,
					height: BOX_H,
					borderWidth: 1,
					borderColor: "#000",
				}}
			/>
			<Rule x={X_FACT} y={0} h={BOX_H} />
			<Rule x={X_ORG} y={0} h={Y_LABELS} />
			<Rule x={X_FECHA} y={0} h={Y_LABELS} />
			<Rule x={X_SIGN} y={0} h={Y_SIGN_END} />
			<Rule x={0} y={Y_LABELS} w={X_SIGN} />
			<Rule x={0} y={Y_VALUES} w={X_SIGN} />
			<Rule x={0} y={Y_PO_LABEL} w={X_FACT} />
			<Rule x={0} y={Y_WORK} w={X_SIGN} />
			<Rule x={X_SIGN} y={Y_SIGN_END} w={W - X_SIGN} />
			<Rule x={X_FACT} y={Y_TOTAL} w={X_SIGN - X_FACT} />

			{/* Row 1: labels; row 2: values */}
			<At left={0} top={6} width={X_FACT} align="center">
				NUMERO SUPLIDOR
			</At>
			<At left={X_FACT} top={6} width={X_ORG - X_FACT} align="center">
				NUMERO DE FACTURA
			</At>
			<At left={X_ORG} top={6} width={X_FECHA - X_ORG} align="center">
				ORG.
			</At>
			<At left={X_FECHA} top={6} width={X_SIGN - X_FECHA} align="center">
				FECHA
			</At>
			<At left={0} top={29} width={X_FACT} align="center" style={styles.bold}>
				{input.supplierNumber}
			</At>
			<At
				left={X_FACT}
				top={29}
				width={X_ORG - X_FACT}
				align="center"
				style={styles.bold}
			>
				{input.avisoNumber}
			</At>
			<At
				left={X_ORG}
				top={29}
				width={X_FECHA - X_ORG}
				align="center"
				style={styles.bold}
			>
				{input.org}
			</At>
			<At
				left={X_FECHA}
				top={29}
				width={X_SIGN - X_FECHA}
				align="center"
				style={styles.bold}
			>
				{input.invoiceDate}
			</At>

			{/* Left column: PO number, job description, locality */}
			<At left={0} top={50} width={X_FACT} align="center">
				NUM. DE ORDEN DE COMPRA
			</At>
			<At
				left={0}
				top={92}
				width={X_FACT}
				align="center"
				style={[styles.bold, { fontSize: 8 }]}
			>
				DESCRIPCION DEL TRABAJO
			</At>
			<View
				style={{ position: "absolute", left: 6, top: 107, width: X_FACT - 10 }}
			>
				<Text style={{ maxLines: 2, marginBottom: 6.5 }}>
					{input.description}
				</Text>
				{input.barrio ? (
					<Text style={{ maxLines: 1 }}>{input.barrio}</Text>
				) : null}
			</View>
			<View
				style={{
					position: "absolute",
					left: 3,
					top: 177,
					width: X_FACT - 6,
					flexDirection: "row",
				}}
			>
				<Text>Localidad: </Text>
				<Text style={[styles.bold, { maxLines: 1 }]}>{input.locality}</Text>
			</View>

			{/* Middle column: work dates, cost block, job kind, total */}
			<At left={mid} top={50}>
				TRABAJO EFECTUADO
			</At>
			<View
				style={{
					position: "absolute",
					left: mid,
					top: 66,
					flexDirection: "row",
				}}
			>
				<Text style={{ width: 36 }}>ENTRE</Text>
				<Text style={[styles.bold, { width: 76 }]}>{input.workFrom}</Text>
				<Text style={styles.bold}>{input.workTo}</Text>
			</View>
			<At left={mid} top={91}>
				COSTO TOTAL:
			</At>
			<At left={mid} top={107}>
				CONTRATO
			</At>
			<At left={mid} top={123}>
				FACTURADO
			</At>
			<At left={mid} top={142}>
				BALANCE
			</At>
			<At left={253} top={107}>
				$
			</At>
			<At left={253} top={123}>
				$
			</At>
			<At left={253} top={142}>
				$
			</At>
			<Check on={input.kind === "INSTALACION"} label="INSTALACION" top={107} />
			<Check
				on={input.kind === "CONSTRUCCION"}
				label="CONSTRUCCION"
				top={123}
			/>
			<Check
				on={input.kind === "MANTENIMIENTO"}
				label="MANTENIMIENTO"
				top={142}
			/>
			<At left={mid} top={168} style={{ fontSize: 7.5 }}>
				TOTAL A PAGAR $
			</At>
			<At left={291} top={167} style={styles.bold}>
				$ {money(input.total)}
			</At>

			{/* Right column: certification / approval signatures */}
			<SignRow label="Certificado por:" top={41} />
			<SignRow label="Aprobado por:" top={71} />
			<SignRow label="Aprobado por:" top={98} />
			<SignRow label="Aprobado por:" top={124} />
			<At left={668} top={150} style={{ fontSize: 6.5 }}>
				{input.jobNumber ?? ""}
			</At>
			<At left={X_SIGN + 2} top={167}>
				ORDEN TRABAJO PLANTA:
			</At>
		</View>
	)
}

function TableHeader() {
	return (
		<View style={styles.th} fixed>
			{COLS.map((c) => (
				<View key={c.head.join(" ")} style={[styles.thCell, { width: c.w }]}>
					{c.head.map((h) => (
						<Text key={h}>{h}</Text>
					))}
				</View>
			))}
		</View>
	)
}

function cell(i: number, extra?: Style): Style {
	const c = COLS[i]
	const pad =
		c.align === "right"
			? { paddingRight: i === 2 ? 3 : 12 }
			: { paddingLeft: 2 }
	return { width: c.w, textAlign: c.align, ...pad, ...extra }
}

function BankInvoice({ input }: { input: BankInvoiceInput }) {
	return (
		<Document>
			<Page size="LETTER" orientation="landscape" style={styles.page}>
				<View style={styles.header}>
					<At left={4} top={2} style={[styles.bold, { fontSize: 10 }]}>
						JAF Communications, Inc.
					</At>
					<At left={6} top={14} style={{ fontSize: 6.5 }}>
						PO Box 11468, CAPARRA HEIGHTS, PR 00922
					</At>
					<At
						left={309}
						top={0}
						width={160}
						align="center"
						style={[styles.bold, { fontSize: 8 }]}
					>
						ACTA DE CONFORMIDAD
					</At>
					<At left={362} top={22} style={{ fontSize: 6.5 }}>
						Contrato Núm. {input.contractLabel}
					</At>
					<View
						style={{
							position: "absolute",
							left: 478,
							top: 4,
							width: 180,
							alignItems: "center",
							fontSize: 8.5,
							fontWeight: "bold",
						}}
					>
						<Text>FACTURA / CERTIFICACION</Text>
						<Text>DE CONTRATISTA A P.R.T.</Text>
					</View>
				</View>

				<MainBox input={input} />

				<TableHeader />
				{input.lines.map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static list, rendered once, never reordered
					<View key={`${l.claroCode}-${i}`} style={styles.tr} wrap={false}>
						<Text style={cell(0)}>{l.claroCode}</Text>
						<Text style={cell(1, { fontSize: 7 })}>{l.description}</Text>
						<Text style={cell(2)}>{l.qty.toFixed(2)}</Text>
						<Text style={cell(3)}>{l.unit}</Text>
						<Text style={cell(4)}>{unitPriceText(l.unitPrice)}</Text>
						<Text style={cell(5)}>{money(l.amount)}</Text>
						<Text style={cell(6)}>{l.accountCode}</Text>
						<Text style={cell(7)}>{l.subAct}</Text>
						<Text style={cell(8)}>{l.dept}</Text>
						<Text style={cell(9)}>{l.profitCenter}</Text>
						<Text style={cell(10)}>{l.act}</Text>
						<Text style={cell(11)}>{l.costCenter}</Text>
					</View>
				))}

				<View style={[styles.tr, styles.bold, { marginTop: 3 }]} wrap={false}>
					<Text
						style={{
							width: COLS.slice(0, 5).reduce((s, c) => s + c.w, 0),
							textAlign: "right",
							paddingRight: 22,
						}}
					>
						Total
					</Text>
					<Text style={cell(5)}>$ {money(input.total)}</Text>
				</View>
				<View wrap={false}>
					<View style={{ flexDirection: "row", marginTop: 13, fontSize: 8 }}>
						<Text style={[styles.bold, { width: 88, paddingLeft: 14 }]}>
							Resumen:
						</Text>
						<Text style={{ width: 80 }}>${money(input.total)}</Text>
						<Text>- - -</Text>
					</View>
					<View
						style={[
							styles.bold,
							{ flexDirection: "row", marginTop: 77, fontSize: 8 },
						]}
					>
						<Text style={{ width: 96, paddingLeft: 42 }}>Total</Text>
						<Text>$ {money(input.total)}</Text>
					</View>
					<Text style={[styles.bold, { marginTop: 133, paddingLeft: 176 }]}>
						Firma: _______________________
					</Text>
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

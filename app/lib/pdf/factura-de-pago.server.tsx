import {
	Document,
	Image,
	Page,
	renderToBuffer,
	Text,
	View,
} from "@react-pdf/renderer"
import type { ComponentProps, ReactNode } from "react"
import { formDate, workRange, zoneOf } from "~/lib/claro-invoice"

type Style = Exclude<
	NonNullable<ComponentProps<typeof View>["style"]>,
	readonly unknown[]
>

/*
 * The "Factura de Pago - Claro", laid out after JAF's real invoices (M19-3635,
 * M19-4971): US Letter portrait, every box placed absolutely, coordinates in
 * points measured off the sample. One PO per invoice, so one PO row.
 */

const LEFT = 18
const RIGHT = 593
const TOP = 65
const X_FACT = 155 // left column | NUMERO DE FACTURA
const X_ORG = 255 // NUMERO DE FACTURA | ORG
const X_FECHA = 282 // ORG | FECHA
const X_SIGN = 348 // FECHA | signature box
const Y_LABELS = 85
const Y_VALUES = 108
const Y_WORK_LABEL = 130
const Y_ENTRE = 150
const Y_SIGN_END = 165
const Y_BAND = 216
const Y_BAND_END = 237
const Y_PO_RULE = 257
const LABEL_FILL = "#e8e8f8"

const money = (n: number) =>
	n.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})

type FacturaParams = {
	/** "M20-001": the number comes from the system. */
	number: string
	madeAt: Date
	workMonth: string
	poNumber: string
	subtotal: number
	ivu4: number
	ivu115: number
	total: number
	/** Lissette's signature, as a data URI. The invoice cannot be made without it. */
	signature: string
}

function At({
	x,
	y,
	w,
	align,
	style,
	children,
}: {
	x: number
	y: number
	w?: number
	align?: "left" | "center" | "right"
	style?: Style
	children: ReactNode
}) {
	return (
		<Text
			style={{
				position: "absolute",
				left: x,
				top: y,
				...(w != null ? { width: w } : {}),
				...(align ? { textAlign: align } : {}),
				...style,
			}}
		>
			{children}
		</Text>
	)
}

function Box({
	x,
	y,
	w,
	h,
	fill,
	width = 1,
}: {
	x: number
	y: number
	w: number
	h: number
	fill?: string
	width?: number
}) {
	return (
		<View
			style={{
				position: "absolute",
				left: x,
				top: y,
				width: w,
				height: h,
				borderWidth: width,
				borderColor: "#000",
				...(fill ? { backgroundColor: fill } : {}),
			}}
		/>
	)
}

function Line({ x, y, w }: { x: number; y: number; w: number }) {
	return (
		<View
			style={{
				position: "absolute",
				left: x,
				top: y,
				width: w,
				borderTopWidth: 0.75,
				borderColor: "#000",
			}}
		/>
	)
}

const bold = { fontWeight: "bold" } as const

/** One row of the signature box; the first carries the signature and its date. */
function SignRow({
	label,
	y,
	signature,
	date,
}: {
	label: string
	y: number
	signature?: string
	date?: string
}) {
	return (
		<>
			<At x={X_SIGN + 9} y={y} style={{ fontSize: 7 }}>
				{label}
			</At>
			<Line x={421} y={y + 9} w={99} />
			{signature ? (
				<Image
					src={signature}
					style={{
						position: "absolute",
						left: 423,
						top: y - 11,
						width: 95,
						height: 20,
						objectFit: "contain",
					}}
				/>
			) : null}
			<At x={522} y={y + 3} style={{ fontSize: 6 }}>
				Fecha:
			</At>
			<Line x={545} y={y + 9} w={43} />
			{date ? (
				<At x={545} y={y} w={43} align="center" style={{ fontSize: 7 }}>
					{date}
				</At>
			) : null}
		</>
	)
}

/**
 * Field for field with JAF's sample: the system's number, the invoice date,
 * the work month as Zona and range, the PO with its amount and IVU, and Lissette's
 * signature beside "Certificado por" and on "Firma". NUMERO SUPLIDOR and the other
 * approvals stay blank.
 */
export async function generateFacturaDePagoPdf(
	p: FacturaParams,
): Promise<Buffer> {
	const range = workRange(p.workMonth)
	const date = formDate(p.madeAt)
	const ivu = Math.round((p.ivu4 + p.ivu115) * 100) / 100
	const doc = (
		<Document>
			<Page
				size="LETTER"
				style={{ fontFamily: "Helvetica", fontSize: 9, color: "#000" }}
			>
				{/* Heading */}
				<At x={22} y={28} style={bold}>
					JAF Communications, Inc.
				</At>
				<At x={22} y={45}>
					PO Box 11468, Caparra Heights, PR 00922-
				</At>
				<At x={487} y={28} style={{ fontSize: 8 }}>
					Page 1 of 1
				</At>
				<At x={395} y={44} style={{ ...bold, fontSize: 12 }}>
					Factura de Pago - Claro
				</At>

				{/* Frame and shaded cells */}
				<Box
					x={LEFT}
					y={TOP}
					w={X_SIGN - LEFT}
					h={Y_LABELS - TOP}
					fill={LABEL_FILL}
				/>
				<Box
					x={LEFT}
					y={Y_VALUES}
					w={X_SIGN - LEFT}
					h={Y_WORK_LABEL - Y_VALUES}
					fill={LABEL_FILL}
				/>
				<Box
					x={LEFT}
					y={Y_BAND}
					w={RIGHT - LEFT}
					h={Y_BAND_END - Y_BAND}
					fill={LABEL_FILL}
					width={1.5}
				/>
				<Box
					x={LEFT}
					y={TOP}
					w={RIGHT - LEFT}
					h={Y_BAND_END - TOP}
					width={1.5}
				/>
				<Box x={X_SIGN} y={TOP} w={RIGHT - X_SIGN} h={Y_SIGN_END - TOP} />
				<View
					style={{
						position: "absolute",
						left: X_FACT,
						top: TOP,
						height: Y_BAND - TOP,
						borderLeftWidth: 1,
						borderColor: "#000",
					}}
				/>
				{[X_ORG, X_FECHA].map((x) => (
					<View
						key={x}
						style={{
							position: "absolute",
							left: x,
							top: TOP,
							height: Y_VALUES - TOP,
							borderLeftWidth: 1,
							borderColor: "#000",
						}}
					/>
				))}
				<Line x={X_FACT} y={Y_ENTRE} w={X_SIGN - X_FACT} />

				{/* Row 1: labels; row 2: values (NUMERO SUPLIDOR stays blank) */}
				<At
					x={LEFT}
					y={71}
					w={X_FACT - LEFT}
					align="center"
					style={{ fontSize: 8 }}
				>
					NUMERO SUPLIDOR
				</At>
				<At
					x={X_FACT}
					y={71}
					w={X_ORG - X_FACT}
					align="center"
					style={{ fontSize: 7.5 }}
				>
					NUMERO DE FACTURA
				</At>
				<At
					x={X_ORG}
					y={71}
					w={X_FECHA - X_ORG}
					align="center"
					style={{ fontSize: 7 }}
				>
					ORG
				</At>
				<At
					x={X_FECHA}
					y={71}
					w={X_SIGN - X_FECHA}
					align="center"
					style={{ fontSize: 8 }}
				>
					FECHA
				</At>
				<At
					x={X_FACT}
					y={92}
					w={X_ORG - X_FACT}
					align="center"
					style={{ ...bold, fontSize: 10 }}
				>
					{p.number}
				</At>
				<At
					x={X_ORG}
					y={92}
					w={X_FECHA - X_ORG}
					align="center"
					style={{ fontSize: 7 }}
				>
					PWOR
				</At>
				<At
					x={X_FECHA}
					y={92}
					w={X_SIGN - X_FECHA}
					align="center"
					style={{ ...bold, fontSize: 10 }}
				>
					{date}
				</At>

				{/* Left column: Zona */}
				<At
					x={LEFT}
					y={114}
					w={X_FACT - LEFT}
					align="center"
					style={{ fontSize: 8 }}
				>
					DESCRIPCION DEL TRABAJO
				</At>
				<At x={22} y={137} style={{ ...bold, fontSize: 8 }}>
					Zona
				</At>
				<At x={22} y={158} style={{ ...bold, fontSize: 10 }}>
					{zoneOf(p.workMonth)}
				</At>

				{/* Middle column: work range, kind of work, amount */}
				<At
					x={X_FACT}
					y={114}
					w={X_SIGN - X_FACT}
					align="center"
					style={{ fontSize: 9 }}
				>
					TRABAJO EFECTUADO
				</At>
				<At x={168} y={135}>
					ENTRE
				</At>
				<At x={203} y={135}>
					{range.from}
				</At>
				<At x={278} y={135}>
					{range.to}
				</At>
				<At x={179} y={158} style={{ ...bold, fontSize: 9.5 }}>
					Mantenimiento Planta Externa
				</At>
				<At x={166} y={196} style={{ ...bold, fontSize: 8 }}>
					Cantidad a Pagar:
				</At>
				<At x={248} y={196} style={bold}>
					$
				</At>
				<At x={275} y={196} style={bold}>
					{money(p.total)}
				</At>

				{/* Signature box: Lissette certifies; the approvals stay blank */}
				<SignRow
					label="Certificado por:"
					y={77}
					signature={p.signature}
					date={date}
				/>
				<SignRow label="Aprobado por:" y={99} />
				<SignRow label="Aprobado por:" y={120} />
				<SignRow label="Aprobado por:" y={143} />

				{/* The PO band and its one row */}
				<At x={26} y={221} style={{ ...bold, fontSize: 9.5 }}>
					Pedido
				</At>
				<At x={93} y={221} style={{ ...bold, fontSize: 9.5 }}>
					{'Números de "Acceptance"'}
				</At>
				<At x={455} y={221} style={{ ...bold, fontSize: 9 }}>
					Importe
				</At>
				<At x={501} y={222} style={{ ...bold, fontSize: 8.5 }}>
					IVU
				</At>
				<At x={538} y={223} style={{ ...bold, fontSize: 7 }}>
					11.5%
				</At>
				<At x={572} y={223} style={{ ...bold, fontSize: 7 }}>
					4%
				</At>
				<At x={20} y={244} style={{ fontSize: 8 }}>
					{p.poNumber}
				</At>
				<At x={432} y={244} w={50} align="right" style={{ fontSize: 8 }}>
					${money(p.subtotal)}
				</At>
				<At x={482} y={244} w={39} align="right" style={{ fontSize: 8 }}>
					${money(ivu)}
				</At>
				<At x={521} y={244} w={31} align="right" style={{ fontSize: 8 }}>
					{money(p.ivu115)}
				</At>
				<At x={552} y={244} w={36} align="right" style={{ fontSize: 8 }}>
					{money(p.ivu4)}
				</At>
				<Line x={LEFT} y={Y_PO_RULE} w={594} />

				{/* Total Pedidos and the totals box */}
				<At x={30} y={275} style={{ ...bold, fontSize: 8 }}>
					Total Pedidos
				</At>
				<At x={122} y={275} style={{ fontSize: 8 }}>
					1
				</At>
				<Box x={443} y={259} w={150} h={73} />
				<At x={472} y={264}>
					Subtotal
				</At>
				<At x={520} y={264} w={65} align="right">
					${money(p.subtotal)}
				</At>
				<At x={462} y={281}>
					IVU Tax 11.5%
				</At>
				<At x={520} y={281} w={65} align="right">
					${money(p.ivu115)}
				</At>
				<At x={462} y={296}>
					IVU Tax 4%
				</At>
				<At x={520} y={296} w={65} align="right">
					${money(p.ivu4)}
				</At>
				<At x={462} y={314}>
					Invoice Total
				</At>
				<At x={528} y={314} style={bold}>
					$
				</At>
				<At x={520} y={314} w={65} align="right" style={bold}>
					{money(p.total)}
				</At>

				{/* Firma, bottom left */}
				<At x={36} y={756} style={{ ...bold, fontSize: 8.5 }}>
					Firma:
				</At>
				<Line x={65} y={766} w={182} />
				<Image
					src={p.signature}
					style={{
						position: "absolute",
						left: 70,
						top: 730,
						width: 170,
						height: 36,
						objectFit: "contain",
					}}
				/>
			</Page>
		</Document>
	)
	return renderToBuffer(doc)
}

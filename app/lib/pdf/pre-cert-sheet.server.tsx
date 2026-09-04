import {
	Document,
	Image,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import type { PreCertLine } from "~/lib/service-lines"

export type PreCertPdfParams = {
	avisoNumber: string | null
	issuedOn: Date
	title: string
	certifiedAddress: string
	lines: PreCertLine[]
	total: number
	sigSupervisor: {
		name: string
		image: string | null
		at: Date | null
	} | null
	sigSubcontractor: {
		name: string
		code: string | null
		image: string | null
		at: Date | null
	} | null
	sigClaro: {
		name: string | null
		image: string | null
		at: Date | null
	} | null
}

const s = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", fontSize: 9 },
	brand: { fontSize: 12, fontWeight: "bold" },
	title: { fontSize: 13, fontWeight: "bold", marginTop: 8 },
	subtitle: { fontSize: 9, color: "#555", marginBottom: 12 },
	row: { flexDirection: "row", marginBottom: 3 },
	label: { color: "#666", width: 70 },
	th: {
		flexDirection: "row",
		backgroundColor: "#1e3a5f",
		color: "#fff",
		padding: 4,
		fontSize: 8,
		marginTop: 10,
	},
	tr: {
		flexDirection: "row",
		padding: 4,
		borderBottom: "0.5px solid #e2e8f0",
		fontSize: 8,
	},
	c1: { flex: 1.2 },
	c2: { flex: 0.7 },
	c3: { flex: 3 },
	c4: { flex: 0.6, textAlign: "right" },
	c5: { flex: 1, textAlign: "right" },
	total: {
		flexDirection: "row",
		justifyContent: "flex-end",
		marginTop: 6,
		fontWeight: "bold",
	},
	certLine: { marginTop: 24, fontStyle: "italic", textAlign: "center" },
	sigs: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 24,
	},
	sig: {
		width: "30%",
		borderTop: "1px solid #000",
		paddingTop: 4,
		alignItems: "center",
	},
	sigImg: { width: 120, height: 45, marginBottom: 4 },
	small: { fontSize: 7, color: "#555" },
})

const fmtDate = (d: Date | null) =>
	d ? new Date(d).toLocaleDateString("es-PR") : ""

function SigBlock({
	label,
	name,
	code,
	image,
	at,
	empty,
}: {
	label: string
	name: string | null
	code?: string | null
	image: string | null
	at: Date | null
	empty: string
}) {
	return (
		<View style={s.sig}>
			{image ? (
				<Image src={image} style={s.sigImg} />
			) : (
				<Text style={s.small}>{empty}</Text>
			)}
			<Text>{label}</Text>
			<Text style={s.small}>
				{name ?? ""}
				{code ? ` · cuenta ${code}` : ""}
			</Text>
			<Text style={s.small}>{fmtDate(at)}</Text>
		</View>
	)
}

export async function generatePreCertSheetPdf(
	p: PreCertPdfParams,
): Promise<Buffer> {
	return renderToBuffer(
		<Document>
			<Page size="LETTER" style={s.page}>
				<Text style={s.brand}>JAF COMMUNICATION</Text>
				<Text style={s.title}>Hoja de Pre-Certificación Contratista</Text>
				<Text style={s.subtitle}>Labor realizada y aceptación de planta</Text>
				<View style={s.row}>
					<Text style={s.label}>Núm. Aviso</Text>
					<Text>{p.avisoNumber ?? "—"}</Text>
				</View>
				<View style={s.row}>
					<Text style={s.label}>Fecha</Text>
					<Text>{fmtDate(p.issuedOn)}</Text>
				</View>
				<View style={s.row}>
					<Text style={s.label}>Título</Text>
					<Text>{p.title}</Text>
				</View>
				<View style={s.row}>
					<Text style={s.label}>Dirección</Text>
					<Text>{p.certifiedAddress}</Text>
				</View>
				<View style={s.th}>
					<Text style={s.c1}>Núm. Servicio</Text>
					<Text style={s.c2}>Cuenta</Text>
					<Text style={s.c3}>Descripción de labor</Text>
					<Text style={s.c4}>Cant.</Text>
					<Text style={s.c5}>Costo</Text>
				</View>
				{p.lines.map((l) => (
					<View key={l.serviceCodeId} style={s.tr}>
						<Text style={s.c1}>{l.claroCode}</Text>
						<Text style={s.c2}>{l.accountCode ?? ""}</Text>
						<Text style={s.c3}>{l.description}</Text>
						<Text style={s.c4}>{l.certifiedQty}</Text>
						<Text style={s.c5}>${l.lineAmount.toFixed(2)}</Text>
					</View>
				))}
				<View style={s.total}>
					<Text>TOTAL ${p.total.toFixed(2)}</Text>
				</View>
				<Text style={s.certLine}>
					Supervisor de Claro aprobó trabajos realizados
				</Text>
				<View style={s.sigs}>
					<SigBlock
						label="Firma Supervisor Contratista"
						name={p.sigSupervisor?.name ?? null}
						image={p.sigSupervisor?.image ?? null}
						at={p.sigSupervisor?.at ?? null}
						empty="Pendiente"
					/>
					<SigBlock
						label="Firma Sub-Contratista"
						name={p.sigSubcontractor?.name ?? null}
						code={p.sigSubcontractor?.code}
						image={p.sigSubcontractor?.image ?? null}
						at={p.sigSubcontractor?.at ?? null}
						empty="Pendiente"
					/>
					<SigBlock
						label="Firma Supervisor Claro"
						name={p.sigClaro?.name ?? null}
						image={p.sigClaro?.image ?? null}
						at={p.sigClaro?.at ?? null}
						empty="No capturada"
					/>
				</View>
			</Page>
		</Document>,
	)
}

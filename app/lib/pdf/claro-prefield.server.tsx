import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { formatDocDate, WORK_ORDER_ISSUER } from "~/lib/work-order-document"

/**
 * The Claro Prefield for a job whose intake answer is "Prefield needed"
 * (spec "Step 4 · Sign off and Generate"). The Prefield is Claro's document:
 * no Claro form exists that JAF knows of, so this layout is ours. JAF fills in
 * what it knows; the four boxes the supervisor used to type (Order #, Pedido,
 * SMR, Título) are Claro's and print blank. One page, bilingual EN / ES.
 */
export type ClaroPrefieldInput = {
	workOrderNumber: string
	address: string
	/** The job as JAF names it (its description). */
	title: string | null
	jafSupervisor: string
	/** The JAF supervisor's area; null when none is assigned. */
	deptNumber: string | null
	claroSupervisor: string | null
	issuedOn: Date
}

const s = StyleSheet.create({
	page: { padding: 36, fontFamily: "Helvetica", fontSize: 10 },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		borderBottom: "1px solid #1e3a5f",
		paddingBottom: 6,
		marginBottom: 14,
	},
	provider: { fontSize: 16, fontWeight: "bold", color: "#1e3a5f" },
	title: { fontSize: 12, fontWeight: "bold" },
	meta: { fontSize: 9, color: "#555", textAlign: "right" },
	h2: {
		fontSize: 11,
		fontWeight: "bold",
		marginTop: 12,
		marginBottom: 6,
		color: "#1e3a5f",
	},
	field: { flexDirection: "row", marginBottom: 4 },
	label: { width: 190, color: "#666" },
	value: { flex: 1 },
	boxes: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	box: {
		width: "48%",
		border: "0.75px solid #94a3b8",
		padding: 6,
		height: 64,
	},
	boxLabel: { fontSize: 9, color: "#475569" },
})

/** Claro's boxes: labelled, left empty for Claro to fill in. */
const CLARO_BOXES = [
	"Order # / # Orden",
	"Order request / Pedido",
	"SMR",
	"Title / Título",
]

function Field({ label, value }: { label: string; value: string | null }) {
	return (
		<View style={s.field}>
			<Text style={s.label}>{label}</Text>
			<Text style={s.value}>{value?.trim() || "—"}</Text>
		</View>
	)
}

export async function generateClaroPrefieldPdf(
	input: ClaroPrefieldInput,
): Promise<Buffer> {
	const issued = formatDocDate(input.issuedOn)
	const element = (
		<Document
			title={`Prefield — ${input.workOrderNumber}`}
			author={WORK_ORDER_ISSUER}
		>
			<Page size="LETTER" style={s.page}>
				<View style={s.header}>
					<View>
						<Text style={s.provider}>{WORK_ORDER_ISSUER}</Text>
						<Text style={s.title}>Claro Prefield / Prefield de Claro</Text>
					</View>
					<View>
						<Text style={s.meta}>{input.workOrderNumber}</Text>
						<Text style={s.meta}>{issued}</Text>
					</View>
				</View>

				<Text style={s.h2}>Filled in by JAF / Completado por JAF</Text>
				<Field
					label="JAF work order # / Orden de trabajo JAF #"
					value={input.workOrderNumber}
				/>
				<Field label="Job address / Dirección" value={input.address} />
				<Field label="Job / Trabajo" value={input.title} />
				<Field
					label="JAF supervisor / Supervisor de JAF"
					value={input.jafSupervisor}
				/>
				<Field label="Dept #" value={input.deptNumber} />
				<Field
					label="Claro supervisor / Supervisor de Claro"
					value={input.claroSupervisor}
				/>
				<Field label="Date / Fecha" value={issued} />

				<Text style={s.h2}>For Claro / Para Claro</Text>
				<View style={s.boxes}>
					{CLARO_BOXES.map((label) => (
						<View key={label} style={s.box}>
							<Text style={s.boxLabel}>{label}</Text>
						</View>
					))}
				</View>
			</Page>
		</Document>
	)
	return renderToBuffer(element)
}

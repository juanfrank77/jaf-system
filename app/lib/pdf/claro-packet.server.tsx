import {
	Document,
	Image,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer"
import { sourceLabelKey } from "~/lib/material-source"
import {
	formatDocDate,
	WORK_ORDER_ISSUER,
	type WorkOrderDocument,
	type WorkOrderSignature,
} from "~/lib/work-order-document"
import { resources } from "~/localization/resource"

/**
 * The JAF work order a Claro supervisor receives for a finished job (spec
 * "Step 4 · Sign off", B5/B6): the same `WorkOrderDocument` the step 4 page
 * shows, block for block in the B5 order. Bilingual EN / ES, JAF as the
 * issuer, and no prices anywhere: the document type carries none. Photos, the
 * blueprint and the Claro Prefield are never drawn here: they travel as their
 * own original files in the package.
 */

export interface ClaroPacketInput {
	document: WorkOrderDocument
	issuedOn: Date
	/**
	 * The warehouse path (`materialsFromWarehouse`): prints the pickup
	 * signatures page. A no-warehouse job has no pickup; its reason prints
	 * under Materials instead.
	 */
	showPickupSignatures: boolean
}

const s = StyleSheet.create({
	page: { padding: 36, fontFamily: "Helvetica", fontSize: 9 },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		borderBottom: "1px solid #1e3a5f",
		paddingBottom: 6,
		marginBottom: 10,
	},
	provider: { fontSize: 16, fontWeight: "bold", color: "#1e3a5f" },
	title: { fontSize: 11, fontWeight: "bold" },
	meta: { fontSize: 8, color: "#555", textAlign: "right" },
	h2: {
		fontSize: 10,
		fontWeight: "bold",
		marginTop: 10,
		marginBottom: 4,
		color: "#1e3a5f",
	},
	h3: { fontSize: 9, fontWeight: "bold", marginTop: 6, marginBottom: 3 },
	field: { flexDirection: "row", marginBottom: 3 },
	label: { width: 150, color: "#666" },
	value: { flex: 1 },
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#1e3a5f",
		color: "#fff",
		padding: 4,
		fontSize: 8,
	},
	tableRow: {
		flexDirection: "row",
		padding: 4,
		borderBottom: "0.5px solid #e2e8f0",
		fontSize: 8,
	},
	code: { flex: 1.2 },
	name: { flex: 3 },
	num: { flex: 0.8, textAlign: "right" },
	source: { flex: 1.8, paddingLeft: 6 },
	empty: { fontSize: 8, color: "#94a3b8", padding: 4 },
	sigRow: { flexDirection: "row", gap: 8, marginTop: 4 },
	sigBox: {
		flex: 1,
		border: "0.5px solid #cbd5e1",
		padding: 6,
		minHeight: 70,
	},
	sigImage: { height: 40, objectFit: "contain", marginVertical: 4 },
	pending: { color: "#b45309", marginTop: 12 },
})

/** "English / Español" from the app's own locale files, so the PDF says what the page says. */
function bilingual(key: string): string {
	const pick = (root: unknown) =>
		key
			.split(".")
			.reduce<unknown>(
				(node, part) =>
					node && typeof node === "object"
						? (node as Record<string, unknown>)[part]
						: undefined,
				root,
			)
	const en = pick(resources.en.common)
	const es = pick(resources.es.common)
	return typeof en === "string" && typeof es === "string"
		? en === es
			? en
			: `${en} / ${es}`
		: key
}

type LoadedImage = { data: Buffer; format: "png" | "jpg" }

/** `data` as an image the renderer can draw: PNG or JPEG only. */
function asImage(data: Buffer): LoadedImage | null {
	if (data.length < 4) return null
	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e)
		return { data, format: "png" }
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
		return { data, format: "jpg" }
	return null
}

/** A drawn signature (a data URL) as an image the renderer can draw. */
function signatureImage(dataUrl: string): LoadedImage | null {
	const comma = dataUrl.indexOf(",")
	if (comma < 0) return null
	return asImage(Buffer.from(dataUrl.slice(comma + 1), "base64"))
}

function Field({ label, value }: { label: string; value: string | null }) {
	return (
		<View style={s.field}>
			<Text style={s.label}>{label}</Text>
			<Text style={s.value}>{value?.trim() || "—"}</Text>
		</View>
	)
}

function Header({ doc, issued }: { doc: WorkOrderDocument; issued: string }) {
	return (
		<View style={s.header} fixed>
			<View>
				<Text style={s.provider}>{WORK_ORDER_ISSUER}</Text>
				<Text style={s.title}>JAF Work Order / Orden de trabajo JAF</Text>
			</View>
			<View>
				<Text style={s.meta}>{doc.workOrderNumber}</Text>
				<Text style={s.meta}>{issued}</Text>
			</View>
		</View>
	)
}

function SignatureBox({
	label,
	sig,
}: {
	label: string
	sig: WorkOrderSignature
}) {
	const image = sig === "pending" ? null : signatureImage(sig.image)
	return (
		<View style={s.sigBox}>
			<Text style={s.h3}>{label}</Text>
			{sig === "pending" ? (
				<Text style={s.pending}>Pending / Pendiente</Text>
			) : (
				<>
					{image && <Image src={image} style={s.sigImage} />}
					<Text>{sig.name || "—"}</Text>
				</>
			)}
		</View>
	)
}

export async function generateClaroPacketPdf(
	input: ClaroPacketInput,
): Promise<Buffer> {
	const doc = input.document
	const issued = formatDocDate(input.issuedOn)

	const element = (
		<Document
			title={`${WORK_ORDER_ISSUER} — ${doc.workOrderNumber}`}
			author={WORK_ORDER_ISSUER}
		>
			<Page size="LETTER" style={s.page}>
				<Header doc={doc} issued={issued} />

				{/* 1–6 */}
				<Field
					label="JAF work order # / Orden de trabajo JAF #"
					value={doc.workOrderNumber}
				/>
				<Field
					label="Claro supervisor / Supervisor de Claro"
					value={doc.claroSupervisor}
				/>
				<Field
					label="JAF supervisor / Supervisor de JAF"
					value={doc.jafSupervisor}
				/>
				<View style={s.field}>
					<Text style={s.label}>Crew / Brigada</Text>
					<View style={s.value}>
						{doc.crews.length === 0 ? (
							<Text>—</Text>
						) : (
							doc.crews.map((c, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static render
								<Text key={i}>
									{c.contractNumber
										? `${c.name} · ${c.contractNumber}`
										: c.name}
								</Text>
							))
						)}
					</View>
				</View>
				<Field label="Job address / Dirección" value={doc.address} />
				<Field label="Job description / Descripción" value={doc.description} />

				{/* 7 */}
				<Text style={s.h2}>Services / Servicios</Text>
				<View style={s.tableHeader}>
					<Text style={s.code}>Code / Código</Text>
					<Text style={s.name}>Description / Descripción</Text>
					<Text style={s.num}>Qty / Cant.</Text>
				</View>
				{doc.services.map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static render; a code can repeat
					<View key={i} style={s.tableRow} wrap={false}>
						<Text style={s.code}>{l.code}</Text>
						<Text style={s.name}>{l.description}</Text>
						<Text style={s.num}>{l.qty}</Text>
					</View>
				))}
				{doc.services.length === 0 && (
					<Text style={s.empty}>No services / Sin servicios</Text>
				)}

				{/* 8 */}
				<Text style={s.h2}>Materials / Materiales</Text>
				{!doc.materialsFromWarehouse && (
					<Field
						label="Not from the warehouse / No del almacén"
						value={doc.materialsReason}
					/>
				)}
				<View style={s.tableHeader}>
					<Text style={s.name}>Material</Text>
					<Text style={s.num}>Used / Usado</Text>
					<Text style={s.source}>Source / Origen</Text>
				</View>
				{doc.materials.map((m, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static render
					<View key={i} style={s.tableRow} wrap={false}>
						<Text style={s.name}>{m.name}</Text>
						<Text style={s.num}>
							{m.used} {m.unit ?? ""}
						</Text>
						<Text style={s.source}>{bilingual(sourceLabelKey(m.source))}</Text>
					</View>
				))}
				{doc.materials.length === 0 && (
					<Text style={s.empty}>No materials / Sin materiales</Text>
				)}

				{/* 9 */}
				<Text style={s.h2}>Field report / Informe de campo</Text>
				<Text>{doc.fieldReport ?? "—"}</Text>

				{/* 10 */}
				<View wrap={false}>
					<Text style={s.h2}>Signatures / Firmas</Text>
					<View style={s.sigRow}>
						<SignatureBox
							label="JAF supervisor / Supervisor de JAF"
							sig={doc.signatures.supervisor}
						/>
					</View>
				</View>
			</Page>

			{/* The pickup signatures: the warehouse path only. */}
			{input.showPickupSignatures && (
				<Page size="LETTER" style={s.page}>
					<Header doc={doc} issued={issued} />
					<Text style={s.h2}>Pickup signatures / Firmas de recogido</Text>
					<View style={s.sigRow}>
						<SignatureBox
							label="Warehouse / Almacén"
							sig={doc.signatures.warehouse}
						/>
						<SignatureBox label="Crew / Brigada" sig={doc.signatures.crew} />
					</View>
				</Page>
			)}
		</Document>
	)

	return renderToBuffer(element)
}

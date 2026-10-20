import { readFile } from "node:fs/promises"
import path from "node:path"
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
 * issuer, and no prices anywhere: the document type carries none.
 */

export interface ClaroPacketInput {
	/** Photo and blueprint references are file paths. */
	document: WorkOrderDocument
	issuedOn: Date
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
	photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	photo: { width: 165, height: 124, objectFit: "contain" },
	blueprint: { width: "100%", maxHeight: 560, objectFit: "contain" },
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

const PHOTO_GROUPS: {
	key: keyof WorkOrderDocument["photos"]
	label: string
}[] = [
	{ key: "before", label: "Before / Antes" },
	{ key: "during", label: "During / Durante" },
	{ key: "after", label: "After / Después" },
]

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

/** A missing or unreadable file is skipped: the packet still goes out. */
const readOrNull = (file: string) => readFile(file).catch(() => null)

async function loadImages(files: string[]): Promise<LoadedImage[]> {
	const loaded = await Promise.all(
		files.map(async (f) => {
			const data = await readOrNull(f)
			return data ? asImage(data) : null
		}),
	)
	return loaded.filter((i): i is LoadedImage => i !== null)
}

/**
 * Blueprints the renderer cannot draw (a PDF plan, a WebP photo): they travel
 * as their own email attachments, and the packet lists them by name.
 */
export async function blueprintAttachments(
	files: string[],
): Promise<{ filename: string; content: Buffer }[]> {
	const out: { filename: string; content: Buffer }[] = []
	for (const f of files) {
		const data = await readOrNull(f)
		if (data && !asImage(data))
			out.push({ filename: path.basename(f), content: data })
	}
	return out
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
	const blueprintFiles = doc.blueprint === "not_required" ? [] : doc.blueprint
	const [before, during, after, blueprintImages, attached] = await Promise.all([
		loadImages(doc.photos.before),
		loadImages(doc.photos.during),
		loadImages(doc.photos.after),
		loadImages(blueprintFiles),
		blueprintAttachments(blueprintFiles),
	])
	const photos = { before, during, after }
	const attachedBlueprints = attached.map((a) => a.filename)
	const issued = formatDocDate(input.issuedOn)
	const prefield = doc.prefield

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
				<Text style={s.h2}>Photos / Fotos</Text>
				{PHOTO_GROUPS.map((g) => (
					<View key={g.key}>
						<Text style={s.h3}>{g.label}</Text>
						{photos[g.key].length === 0 ? (
							<Text style={s.empty}>No photos / Sin fotos</Text>
						) : (
							<View style={s.photoGrid}>
								{photos[g.key].map((img, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static render, no reordering
									<Image key={i} src={img} style={s.photo} />
								))}
							</View>
						)}
					</View>
				))}

				{/* 10 */}
				<Text style={s.h2}>Blueprint / Plano</Text>
				{doc.blueprint === "not_required" ? (
					<Text>Not required / No requerido</Text>
				) : (
					<>
						{blueprintImages.map((img, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static render, no reordering
							<Image key={i} src={img} style={s.blueprint} />
						))}
						{attachedBlueprints.length > 0 && (
							<View>
								<Text style={s.h3}>
									Attached separately / Adjunto por separado
								</Text>
								{attachedBlueprints.map((name) => (
									<Text key={name}>{name}</Text>
								))}
							</View>
						)}
						{blueprintFiles.length === 0 && <Text style={s.empty}>—</Text>}
					</>
				)}

				{/* 11 */}
				<Text style={s.h2}>Prefield</Text>
				{prefield === "not_required" ? (
					<Text>
						Not required by this Claro supervisor / No requerido por este
						supervisor de Claro
					</Text>
				) : (
					<>
						<Field label="Order # / # Orden" value={prefield.ordenNumber} />
						<Field label="Order request / Pedido" value={prefield.pedido} />
						<Field label="SMR" value={prefield.smr} />
						<Field label="Title / Título" value={prefield.titulo} />
					</>
				)}

				{/* 12 */}
				<Text style={s.h2}>Field report / Informe de campo</Text>
				<Text>{doc.fieldReport ?? "—"}</Text>

				{/* 13 */}
				<View wrap={false}>
					<Text style={s.h2}>Signatures / Firmas</Text>
					<View style={s.sigRow}>
						<SignatureBox
							label="JAF supervisor / Supervisor de JAF"
							sig={doc.signatures.supervisor}
						/>
						<SignatureBox
							label="Warehouse / Almacén"
							sig={doc.signatures.warehouse}
						/>
						<SignatureBox label="Crew / Brigada" sig={doc.signatures.crew} />
					</View>
				</View>
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

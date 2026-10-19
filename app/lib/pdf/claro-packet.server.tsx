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

/**
 * The packet a Claro supervisor receives for a finished job (spec "Step 5 ·
 * Packet → Claro"): Prefield page (only when that supervisor requires it),
 * work summary, materials, blueprints and photos. Bilingual EN / ES, IMS as
 * the provider, and no prices anywhere: the input type carries none.
 */

type PhotoGroup = "BEFORE" | "DURING" | "AFTER"

export interface ClaroPacketInput {
	controlNumber: string
	claroSupervisorName: string
	showPrefield: boolean
	prefield: {
		avisoNumber: string | null
		ordenNumber: string | null
		pedido: string | null
		smr: string | null
		titulo: string | null
		description: string | null
	}
	address: {
		direccion1: string | null
		direccion2: string | null
		sector: string | null
		ciudad: string | null
		latitud: string | null
		longitud: string | null
		tipo: string | null
		tipoPlanta: string | null
		grupoPlan: string | null
	}
	/** Always printed, so a packet without the Prefield page still names the job. */
	job: {
		address: string
		jobType: string
		description: string | null
		workDate: Date | null
		avisoNumber: string | null
	}
	workSummary: {
		claroCode: string
		name: string
		qty: number
		unit: string | null
	}[]
	materials: {
		claroCode: string
		name: string
		unit: string | null
		used: number
		returned: number
		source: "WAREHOUSE" | "BRIGADE_STOCK"
	}[]
	photos: Record<PhotoGroup, string[]>
	blueprints: string[]
	supervisorName: string
	signedOffAt: Date | null
}

const PROVIDER = "IMS"

const s = StyleSheet.create({
	page: { padding: 36, fontFamily: "Helvetica", fontSize: 9 },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		borderBottom: "1px solid #1e3a5f",
		paddingBottom: 6,
		marginBottom: 14,
	},
	provider: { fontSize: 16, fontWeight: "bold", color: "#1e3a5f" },
	title: { fontSize: 11, fontWeight: "bold" },
	meta: { fontSize: 8, color: "#555", textAlign: "right" },
	h2: {
		fontSize: 11,
		fontWeight: "bold",
		marginTop: 12,
		marginBottom: 6,
		color: "#1e3a5f",
	},
	h3: { fontSize: 9, fontWeight: "bold", marginTop: 8, marginBottom: 4 },
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
	source: { flex: 1.6, paddingLeft: 6 },
	empty: { fontSize: 8, color: "#94a3b8", padding: 4 },
	signoff: {
		marginTop: 24,
		borderTop: "1px solid #ccc",
		paddingTop: 10,
	},
	photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	photo: { width: 165, height: 124, objectFit: "contain" },
	blueprint: { width: "100%", maxHeight: 620, objectFit: "contain" },
})

const PHOTO_GROUPS: { key: PhotoGroup; label: string }[] = [
	{ key: "BEFORE", label: "Before / Antes" },
	{ key: "DURING", label: "During / Durante" },
	{ key: "AFTER", label: "After / Después" },
]

const SOURCE_LABEL: Record<
	ClaroPacketInput["materials"][number]["source"],
	string
> = {
	WAREHOUSE: "Warehouse / Almacén",
	BRIGADE_STOCK: "Brigade stock / Inventario de brigada",
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

const formatDate = (d: Date) =>
	new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(
		d,
	)

function Field({ label, value }: { label: string; value: string | null }) {
	return (
		<View style={s.field}>
			<Text style={s.label}>{label}</Text>
			<Text style={s.value}>{value?.trim() || "—"}</Text>
		</View>
	)
}

function Header({
	input,
	issued,
}: {
	input: ClaroPacketInput
	issued: string
}) {
	return (
		<View style={s.header} fixed>
			<View>
				<Text style={s.provider}>{PROVIDER}</Text>
				<Text style={s.title}>Work packet / Paquete de trabajo</Text>
			</View>
			<View>
				<Text style={s.meta}>
					Control # / Núm. de control: {input.controlNumber}
				</Text>
				<Text style={s.meta}>
					Claro supervisor / Supervisor de Claro: {input.claroSupervisorName}
				</Text>
				<Text style={s.meta}>Issued / Emitido: {issued}</Text>
			</View>
		</View>
	)
}

export async function generateClaroPacketPdf(
	input: ClaroPacketInput,
): Promise<Buffer> {
	const [before, during, after, blueprintImages, attached] = await Promise.all([
		loadImages(input.photos.BEFORE),
		loadImages(input.photos.DURING),
		loadImages(input.photos.AFTER),
		loadImages(input.blueprints),
		blueprintAttachments(input.blueprints),
	])
	const photos: Record<PhotoGroup, LoadedImage[]> = {
		BEFORE: before,
		DURING: during,
		AFTER: after,
	}
	const attachedBlueprints = attached.map((a) => a.filename)

	const issued = formatDate(new Date())
	const { prefield, address } = input

	const element = (
		<Document title={`${PROVIDER} — ${input.controlNumber}`} author={PROVIDER}>
			{input.showPrefield && (
				<Page size="LETTER" style={s.page}>
					<Header input={input} issued={issued} />
					<Text style={s.h2}>Prefield form / Formulario Prefield</Text>
					<Field label="Aviso #" value={prefield.avisoNumber} />
					<Field label="Order # / # Orden" value={prefield.ordenNumber} />
					<Field label="Order request / Pedido" value={prefield.pedido} />
					<Field label="SMR" value={prefield.smr} />
					<Field label="Title / Título" value={prefield.titulo} />
					<Field
						label="Description / Descripción"
						value={prefield.description}
					/>
					<Text style={s.h2}>Address / Dirección</Text>
					<Field label="Address 1 / Dirección 1" value={address.direccion1} />
					<Field label="Address 2 / Dirección 2" value={address.direccion2} />
					<Field label="Sector" value={address.sector} />
					<Field label="City / Ciudad" value={address.ciudad} />
					<Field label="Latitude / Latitud" value={address.latitud} />
					<Field label="Longitude / Longitud" value={address.longitud} />
					<Field label="Type / Tipo" value={address.tipo} />
					<Field label="Plant type / Tipo planta" value={address.tipoPlanta} />
					<Field label="Plan group / Grupo plan" value={address.grupoPlan} />
				</Page>
			)}

			<Page size="LETTER" style={s.page}>
				<Header input={input} issued={issued} />
				<Text style={s.h2}>Job / Trabajo</Text>
				{input.job.avisoNumber && (
					<Field label="Aviso #" value={input.job.avisoNumber} />
				)}
				<Field label="Address / Dirección" value={input.job.address} />
				{address.sector && <Field label="Sector" value={address.sector} />}
				{address.ciudad && (
					<Field label="City / Ciudad" value={address.ciudad} />
				)}
				{address.tipo && <Field label="Type / Tipo" value={address.tipo} />}
				<Field label="Job type / Tipo de trabajo" value={input.job.jobType} />
				<Field
					label="Description / Descripción"
					value={input.job.description}
				/>
				<Field
					label="Work date / Fecha del trabajo"
					value={input.job.workDate ? formatDate(input.job.workDate) : null}
				/>

				<Text style={s.h2}>Work summary / Resumen del trabajo</Text>
				<View style={s.tableHeader}>
					<Text style={s.code}>Code / Código</Text>
					<Text style={s.name}>Description / Descripción</Text>
					<Text style={s.num}>Qty / Cant.</Text>
					<Text style={s.num}>Unit / Unidad</Text>
				</View>
				{input.workSummary.map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static render; a code can repeat
					<View key={i} style={s.tableRow} wrap={false}>
						<Text style={s.code}>{l.claroCode}</Text>
						<Text style={s.name}>{l.name}</Text>
						<Text style={s.num}>{l.qty}</Text>
						<Text style={s.num}>{l.unit ?? ""}</Text>
					</View>
				))}
				{input.workSummary.length === 0 && (
					<Text style={s.empty}>
						No service lines / Sin partidas de servicio
					</Text>
				)}

				<Text style={s.h2}>Materials / Materiales</Text>
				<View style={s.tableHeader}>
					<Text style={s.code}>Code / Código</Text>
					<Text style={s.name}>Description / Descripción</Text>
					<Text style={s.num}>Used / Usado</Text>
					<Text style={s.num}>Returned / Devuelto</Text>
					<Text style={s.source}>Source / Origen</Text>
				</View>
				{input.materials.map((m) => (
					<View
						key={`${m.claroCode}-${m.source}`}
						style={s.tableRow}
						wrap={false}
					>
						<Text style={s.code}>{m.claroCode}</Text>
						<Text style={s.name}>{m.name}</Text>
						<Text style={s.num}>
							{m.used} {m.unit ?? ""}
						</Text>
						<Text style={s.num}>
							{m.returned} {m.unit ?? ""}
						</Text>
						<Text style={s.source}>{SOURCE_LABEL[m.source]}</Text>
					</View>
				))}
				{input.materials.length === 0 && (
					<Text style={s.empty}>No materials / Sin materiales</Text>
				)}

				<View style={s.signoff} wrap={false}>
					<Text style={s.h3}>Sign-off / Aprobación</Text>
					<Field label="Provider / Proveedor" value={PROVIDER} />
					<Field
						label="Signed off by / Aprobado por"
						value={input.supervisorName}
					/>
					<Field
						label="Date / Fecha"
						value={input.signedOffAt ? formatDate(input.signedOffAt) : null}
					/>
				</View>
			</Page>

			{input.blueprints.length > 0 && (
				<Page size="LETTER" style={s.page}>
					<Header input={input} issued={issued} />
					<Text style={s.h2}>Blueprint / Plano</Text>
					{blueprintImages.map((img, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static render, no reordering
						<View key={i} break={i > 0}>
							<Image src={img} style={s.blueprint} />
						</View>
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
				</Page>
			)}

			<Page size="LETTER" style={s.page}>
				<Header input={input} issued={issued} />
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
			</Page>
		</Document>
	)

	return renderToBuffer(element)
}

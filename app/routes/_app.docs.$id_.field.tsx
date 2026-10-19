import path from "node:path"
import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useFetcher, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FieldMaterialsTable,
	type FieldMaterialsTableRow,
} from "~/components/field-materials-table"
import { JobStepRail } from "~/components/job-step-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import {
	billableUsed,
	exceedsSigned,
	type FieldMaterialRow,
	fieldMaterialsOrDefault,
	parseFieldMaterials,
	quantityDiscrepancies,
} from "~/lib/field-materials"
import {
	type AddressCorrection,
	buildAddressCorrection,
	mergeAddressCorrections,
} from "~/lib/field-update-helpers"
import {
	uploadFileName,
	validateBlueprintFile,
	validateFile,
} from "~/lib/file-upload.server"
import { composeJobAddress } from "~/lib/intake-address"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { ServiceLine } from "~/lib/service-lines"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import { SUPERVISOR_STAGES } from "~/lib/supervisor-stage"
import { photosThatLoad, saveUpload } from "~/lib/uploads.server"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.field"

type MaterialLine = { serviceCodeId: string; qty: number }
type PhotoTag = "BEFORE" | "DURING" | "AFTER"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Field Update — JAF Ops`
			: "JAF Ops",
	},
]

/**
 * Field is open from pickup until sign-off, which locks it for the
 * supervisor. Only an Admin may still change it after sign-off (the existing
 * override), and only until the job moves past SUPERVISOR_APPROVED.
 */
const FIELD_OPEN_STATUSES = ["SIGNED", "FIELD_UPDATED"]
const ADMIN_FIELD_OPEN_STATUSES = [
	...FIELD_OPEN_STATUSES,
	"SUPERVISOR_APPROVED",
]

function fieldIsOpen(
	doc: { status: string; supervisorApprovedAt: Date | null },
	role: string,
): boolean {
	if (role === "ADMIN") return ADMIN_FIELD_OPEN_STATUSES.includes(doc.status)
	return FIELD_OPEN_STATUSES.includes(doc.status) && !doc.supervisorApprovedAt
}

const PHOTO_FIELDS: [string, PhotoTag][] = [
	["photosBefore", "BEFORE"],
	["photosDuring", "DURING"],
	["photosAfter", "AFTER"],
]

/** Aviso-style location columns the address correction may change. */
const ADDRESS_COLUMNS = [
	"sector",
	"direccion1",
	"direccion2",
	"latitud",
	"longitud",
	"ciudad",
] as const
type AddressColumn = (typeof ADDRESS_COLUMNS)[number]

// Only what the Field step shows: no price, payable or invoice-line column
// is fetched, so none can reach a price-blind supervisor.
const FIELD_DOC_SELECT = {
	id: true,
	controlNumber: true,
	status: true,
	supervisorId: true,
	brigade: { select: { area: true, name: true } },
	assignedCrewIds: true,
	sector: true,
	direccion1: true,
	direccion2: true,
	latitud: true,
	longitud: true,
	ciudad: true,
	jobAddressEstimated: true,
	jobAddressActual: true,
	addressCorrections: true,
	materialsTaken: true,
	estimatedMaterials: true,
	fieldMaterials: true,
	serviceLines: true,
	installedServiceLines: true,
	fieldNotes: true,
	fieldStartedAt: true,
	fieldSubmittedAt: true,
	supervisorApprovedAt: true,
	blueprintPaths: true,
	claroSupervisor: { select: { name: true, requiresBlueprint: true } },
} satisfies Prisma.JafInvoiceSelect

type FieldDoc = Prisma.JafInvoiceGetPayload<{
	select: typeof FIELD_DOC_SELECT
}>

async function openFieldDoc(request: Request, id: string) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id },
		select: FIELD_DOC_SELECT,
	})
	if (user.role === "SUPERVISOR")
		await assertDocInSupervisorScope(db, user.id, doc)
	if (!fieldIsOpen(doc, user.role)) throw redirect(`/docs/${id}`)
	return { user, doc }
}

function lines(v: unknown): MaterialLine[] {
	return Array.isArray(v) ? (v as MaterialLine[]) : []
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user, doc } = await openFieldDoc(request, params.id)
	const taken = lines(doc.materialsTaken)
	const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
	const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? null
	const corrections =
		(doc.addressCorrections as AddressCorrection[] | null) ?? []
	const shared = doc.assignedCrewIds.length > 1

	const [codes, photoRows, serviceUnits] = await Promise.all([
		getActiveMaterialCodes(),
		db.photo.findMany({
			where: { docId: doc.id },
			orderBy: { takenAt: "asc" },
			select: { id: true, tag: true, localPath: true },
		}),
		ordered.length > 0
			? db.serviceCode.findMany({
					where: { id: { in: ordered.map((l) => l.serviceCodeId) } },
					select: { id: true, unit: true },
				})
			: Promise.resolve([]),
	])
	const unitOf = new Map(serviceUnits.map((c) => [c.id, c.unit]))
	const photos: Record<PhotoTag, { id: string; src: string }[]> = {
		BEFORE: [],
		DURING: [],
		AFTER: [],
	}
	for (const p of await photosThatLoad(doc.id, photoRows)) {
		if (!p.tag) continue
		photos[p.tag].push({
			id: p.id,
			src: `/files/photos/${doc.id}/${path.basename(p.localPath)}`,
		})
	}

	// Names for whoever edited the address and, on a shared job, the brigades.
	const nameIds = [
		...new Set([
			...corrections.map((c) => c.correctedById),
			...(shared ? doc.assignedCrewIds : []),
		]),
	]
	const people =
		nameIds.length > 0
			? await db.user.findMany({
					where: { id: { in: nameIds } },
					select: { id: true, name: true },
				})
			: []
	const nameOf = new Map(people.map((u) => [u.id, u.name]))

	return {
		user: { id: user.id, role: user.role },
		doc: {
			id: doc.id,
			controlNumber: doc.controlNumber,
			status: doc.status,
			sector: doc.sector,
			direccion1: doc.direccion1,
			direccion2: doc.direccion2,
			latitud: doc.latitud,
			longitud: doc.longitud,
			ciudad: doc.ciudad,
			jobAddressEstimated: doc.jobAddressEstimated,
			jobAddressActual: doc.jobAddressActual,
			fieldNotes: doc.fieldNotes,
			fieldStartedAt: doc.fieldStartedAt,
			fieldSubmittedAt: doc.fieldSubmittedAt,
		},
		addressCorrections: corrections,
		correctorNames: Object.fromEntries(
			corrections.map((c) => [c.correctedById, nameOf.get(c.correctedById)]),
		),
		photos,
		blueprints: doc.blueprintPaths.map((p) => path.basename(p)),
		blueprintRequired: doc.claroSupervisor?.requiresBlueprint ?? false,
		materialsTaken: taken,
		estimatedMaterials: lines(doc.estimatedMaterials),
		fieldMaterials: fieldMaterialsOrDefault(doc.fieldMaterials, taken),
		serviceLines: ordered,
		installedServiceLines: installed,
		services: {
			rows: ordered.map((l) => ({
				serviceCodeId: l.serviceCodeId,
				claroCode: l.claroCode,
				name: l.name,
				estimated: l.qty,
				actual:
					installed?.find((i) => i.serviceCodeId === l.serviceCodeId)?.qty ??
					null,
				unit: unitOf.get(l.serviceCodeId) ?? null,
			})),
			brigadeNames: shared
				? doc.assignedCrewIds
						.map((id) => nameOf.get(id))
						.filter((n): n is string => !!n)
				: [],
		},
		serviceCodes: serviceCodesForRole(user.role, codes),
	}
}

type Refusal = { errorKey: ParseKeys }

function refusal(key: ParseKeys): Refusal {
	return { errorKey: key }
}

function files(form: FormData, name: string): File[] {
	return form
		.getAll(name)
		.filter((f): f is File => f instanceof File && f.size > 0)
}

/** Zero is a legitimate installed quantity, so this does not use parseServiceLines. */
function parseInstalled(raw: string): ServiceLine[] {
	const parsed = JSON.parse(raw) as Record<string, unknown>[]
	if (!Array.isArray(parsed)) throw new Error("Not a list")
	return parsed
		.filter(
			(l) => l && typeof l.serviceCodeId === "string" && Number(l.qty) >= 0,
		)
		.map((l) => ({
			serviceCodeId: String(l.serviceCodeId),
			claroCode: String(l.claroCode ?? ""),
			accountCode: l.accountCode ? String(l.accountCode) : null,
			name: String(l.name ?? ""),
			qty: Number(l.qty),
		}))
}

/**
 * The address correction: Dirección 1 (or, from an older form,
 * `jobAddressActual`) and the other Aviso location columns. Fields the post
 * leaves out keep their stored value. Returns the columns to write, or
 * nothing when the post carries no address.
 */
function addressUpdate(
	form: FormData,
	doc: FieldDoc,
	userId: string,
): Refusal | Prisma.JafInvoiceUpdateInput | null {
	if (!form.has("direccion1") && !form.has("jobAddressActual")) return null
	const text = (k: string) => {
		const v = form.get(k)
		return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""
	}
	const direccion1 = form.has("direccion1")
		? text("direccion1")
		: text("jobAddressActual")
	if (!direccion1) return refusal("docs_field.errors.address_required")

	const next: Record<AddressColumn, string | null> = {
		sector: doc.sector,
		direccion1,
		direccion2: doc.direccion2,
		latitud: doc.latitud,
		longitud: doc.longitud,
		ciudad: doc.ciudad,
	}
	for (const k of ADDRESS_COLUMNS) {
		if (k !== "direccion1" && form.has(k)) next[k] = text(k) || null
	}
	const out: Prisma.JafInvoiceUpdateInput = {}
	for (const k of ADDRESS_COLUMNS) {
		if (next[k] !== doc[k]) out[k] = next[k]
	}
	if (Object.keys(out).length === 0) return out

	const composed = composeJobAddress({ direccion1, sector: next.sector })
	if (composed !== doc.jobAddressEstimated) out.jobAddressEstimated = composed
	const previous = doc.jobAddressActual || doc.jobAddressEstimated
	if (composed !== previous) {
		out.jobAddressActual = composed
		out.addressCorrections = mergeAddressCorrections({
			existing: doc.addressCorrections as AddressCorrection[] | null,
			correction: buildAddressCorrection({
				original: previous,
				corrected: composed,
				correctedById: userId,
			}),
		}) as unknown as Prisma.InputJsonValue
	}
	return out
}

/**
 * Two intents. `save` writes whatever the post carries (partial, idempotent,
 * never changes status; the first one stamps `fieldStartedAt`). `continue`
 * does the same, then checks the materials table and moves SIGNED →
 * FIELD_UPDATED. No signature here (that is Sign off) and no crew
 * notification. The Claro supervisor's blueprint rule is enforced at send
 * time, not here.
 */
export async function action({ request, params }: Route.ActionArgs) {
	const { user, doc } = await openFieldDoc(request, params.id)
	const form = await request.formData()
	const intent = form.get("intent")
	if (intent !== "save" && intent !== "continue")
		throw data({ error: "Unknown intent" }, { status: 400 })

	const photos = PHOTO_FIELDS.flatMap(([name, tag]) =>
		files(form, name).map((file) => ({ file, tag })),
	)
	if (photos.some(({ file }) => !validateFile(file, "photo").valid))
		return refusal("docs_field.errors.photo_invalid")
	const blueprints = files(form, "blueprint")
	if (blueprints.some((file) => !validateBlueprintFile(file).valid))
		return refusal("docs_field.errors.blueprint_invalid")

	const update: Prisma.JafInvoiceUpdateInput = {}

	let rows: FieldMaterialRow[] | null = null
	if (form.has("fieldMaterials")) {
		try {
			rows = parseFieldMaterials(form.get("fieldMaterials") as string)
		} catch {
			return refusal("docs_field.errors.invalid_materials")
		}
	}

	if (form.has("installedServiceLines")) {
		try {
			update.installedServiceLines = parseInstalled(
				form.get("installedServiceLines") as string,
			)
		} catch {
			return refusal("docs_field.errors.invalid_service_lines")
		}
	}

	if (form.has("fieldNotes"))
		update.fieldNotes = (form.get("fieldNotes") as string).trim() || null

	const address = addressUpdate(form, doc, user.id)
	if (address && "errorKey" in address) return address
	if (address) Object.assign(update, address)

	const taken = lines(doc.materialsTaken)
	let discrepancies: ReturnType<typeof quantityDiscrepancies> = []
	const discrepancyNote =
		(form.get("discrepancyNote") as string | null)?.trim() || null
	if (intent === "continue") {
		rows ??= fieldMaterialsOrDefault(doc.fieldMaterials, taken)
		// The used ≤ signed-out rule covers WAREHOUSE rows only.
		if (exceedsSigned(taken, rows))
			return refusal("docs_field.errors.used_exceeds_took")
		discrepancies = quantityDiscrepancies(taken, rows)
		if (discrepancies.length > 0 && !discrepancyNote)
			return refusal("docs_field.errors.discrepancy_note_required")
	}
	if (rows) {
		// Brigade's stock stays in fieldMaterials (tracked), off the billable
		// lines until Finance rules on it.
		update.fieldMaterials = rows
		update.materialsUsed = billableUsed(rows)
	}

	// Everything is valid: only now write files.
	const photoPaths: { path: string; tag: PhotoTag }[] = []
	for (const [i, { file, tag }] of photos.entries())
		photoPaths.push({
			path: await saveUpload(`photos/${doc.id}`, uploadFileName(file, i), file),
			tag,
		})
	const blueprintPaths: string[] = []
	for (const [i, file] of blueprints.entries())
		blueprintPaths.push(
			await saveUpload(`blueprints/${doc.id}`, uploadFileName(file, i), file),
		)
	if (blueprintPaths.length > 0)
		update.blueprintPaths = [...doc.blueprintPaths, ...blueprintPaths]

	const now = new Date()
	if (!doc.fieldStartedAt) update.fieldStartedAt = now
	const advances =
		intent === "continue" &&
		doc.status === "SIGNED" &&
		canTransition(doc.status, "FIELD_UPDATED", user.role)
	if (intent === "continue") update.fieldSubmittedAt = now
	if (advances) update.status = "FIELD_UPDATED"

	const ops: Prisma.PrismaPromise<unknown>[] = photoPaths.map(({ path, tag }) =>
		db.photo.create({
			data: { docId: doc.id, uploadedById: user.id, localPath: path, tag },
		}),
	)
	if (Object.keys(update).length > 0)
		ops.push(db.jafInvoice.update({ where: { id: doc.id }, data: update }))
	if (advances)
		ops.push(
			db.auditTrail.create({
				data: {
					docId: doc.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: doc.status, after: "FIELD_UPDATED" },
						materialsUsed: update.materialsUsed ?? null,
					} as Prisma.InputJsonValue,
				},
			}),
		)
	// Logged once, with the Continue that moves the job to Sign off; a later
	// Continue from FIELD_UPDATED re-checks the note but adds no second row.
	if (advances && discrepancies.length > 0)
		ops.push(
			db.auditTrail.create({
				data: {
					docId: doc.id,
					userId: user.id,
					action: "QUANTITY_DISCREPANCY",
					diffJson: {
						discrepancies,
						note: discrepancyNote,
						blocksFinance: false,
					},
				},
			}),
		)
	if (ops.length > 0) await db.$transaction(ops)

	if (intent === "continue") throw redirect(`/docs/${doc.id}/review`)
	return { ok: true as const }
}

/** Each photo box holds this many; the upload hides once a box is full. */
const MAX_PHOTOS_PER_BOX = 4

const PHOTO_BOXES: [PhotoTag, string, ParseKeys][] = [
	["BEFORE", "photosBefore", "docs_field.photos_before_label"],
	["DURING", "photosDuring", "docs_field.photos_during_label"],
	["AFTER", "photosAfter", "docs_field.photos_after_label"],
]

const SIGN_OFF_STEP = SUPERVISOR_STAGES.indexOf("APPROVE") + 1

type ActionResult = { errorKey?: ParseKeys; ok?: true } | undefined

/** The Field `save` intent, posted on its own as soon as files are picked. */
function useFileAutosave() {
	const fetcher = useFetcher<ActionResult>()
	const send = (name: string, files: File[]) => {
		if (files.length === 0) return
		const form = new FormData()
		form.set("intent", "save")
		for (const f of files) form.append(name, f)
		fetcher.submit(form, { method: "post", encType: "multipart/form-data" })
	}
	return {
		send,
		busy: fetcher.state !== "idle",
		errorKey: fetcher.data?.errorKey,
	}
}

function PhotoBox({
	name,
	labelKey,
	photos,
}: {
	name: string
	labelKey: ParseKeys
	photos: { id: string; src: string }[]
}) {
	const { t } = useTranslation()
	const upload = useFileAutosave()
	const room = Math.max(0, MAX_PHOTOS_PER_BOX - photos.length)
	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-2">
				<Label htmlFor={room > 0 ? name : undefined}>{t(labelKey)}</Label>
				<span className="text-xs text-muted-foreground">
					{upload.busy
						? t("docs_field.photo_uploading")
						: t("docs_field.photo_count", {
								count: photos.length,
								max: MAX_PHOTOS_PER_BOX,
							})}
				</span>
			</div>
			<div className="grid grid-cols-4 gap-2">
				{photos.map((p) => (
					<a
						key={p.id}
						href={p.src}
						target="_blank"
						rel="noreferrer"
						className="block aspect-square overflow-hidden rounded-lg border"
					>
						<img src={p.src} alt="" className="h-full w-full object-cover" />
					</a>
				))}
				{Array.from({ length: room }, (_, i) => (
					<label
						// biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no identity
						key={i}
						htmlFor={name}
						data-testid="photo-slot-empty"
						className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground hover:bg-muted"
					>
						{i === 0 ? t("docs_field.photo_add") : null}
					</label>
				))}
			</div>
			{room > 0 && (
				<input
					id={name}
					name={name}
					type="file"
					accept="image/*"
					multiple
					className="sr-only"
					disabled={upload.busy}
					onChange={(e) => {
						// The box takes four: anything picked beyond the room left is dropped.
						upload.send(name, [...(e.target.files ?? [])].slice(0, room))
						e.target.value = ""
					}}
				/>
			)}
			{upload.errorKey && (
				<p role="alert" className="text-xs text-status-danger">
					{t(upload.errorKey)}
				</p>
			)}
		</div>
	)
}

function BlueprintBox({
	docId,
	files,
	required,
}: {
	docId: string
	files: string[]
	required: boolean
}) {
	const { t } = useTranslation()
	const upload = useFileAutosave()
	return (
		<div className="space-y-2">
			<Label htmlFor="blueprint">{t("docs_field.blueprint_label")}</Label>
			{required && (
				<p className="text-xs text-status-warn">
					{t("docs_field.blueprint_required_hint")}
				</p>
			)}
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{files.map((f) => (
					<a
						key={f}
						href={`/files/blueprints/${docId}/${f}`}
						target="_blank"
						rel="noreferrer"
						className="flex min-h-16 items-center justify-center break-all rounded-lg border p-2 text-center text-xs text-accent-text underline"
					>
						{f.replace(/^\d+-\d+-/, "")}
					</a>
				))}
				<label
					htmlFor="blueprint"
					className="flex min-h-16 cursor-pointer items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground hover:bg-muted"
				>
					{upload.busy
						? t("docs_field.photo_uploading")
						: t("docs_field.blueprint_add")}
				</label>
			</div>
			{files.length === 0 && (
				<p className="text-xs text-muted-foreground">
					{t("docs_field.blueprint_empty")}
				</p>
			)}
			<input
				id="blueprint"
				name="blueprint"
				type="file"
				accept="application/pdf,image/*"
				multiple
				className="sr-only"
				disabled={upload.busy}
				onChange={(e) => {
					upload.send("blueprint", [...(e.target.files ?? [])])
					e.target.value = ""
				}}
			/>
			{upload.errorKey && (
				<p role="alert" className="text-xs text-status-danger">
					{t(upload.errorKey)}
				</p>
			)}
		</div>
	)
}

/**
 * Step 3 · Field, filled by the supervisor from what the crew sends on
 * WhatsApp (mockup 4): Before / During / After photos, blueprints, the address
 * correction with its history, the actual services (no prices) and the one
 * materials table. Photos and blueprints save the moment they are picked;
 * "Save progress" posts every other field; "Continue" goes on to Sign off.
 */
export default function FieldUpdate({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		user,
		addressCorrections,
		correctorNames,
		photos,
		blueprints,
		blueprintRequired,
		materialsTaken,
		estimatedMaterials,
		fieldMaterials,
		serviceLines,
		services,
		serviceCodes,
	} = loaderData
	const { t } = useTranslation()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const result = actionData as ActionResult

	// Address fields are only posted once edited, so saving a job that has no
	// Dirección 1 yet (created before the Aviso-style address) never trips the
	// "Dirección 1 is required" check.
	const [addressDirty, setAddressDirty] = useState(false)
	const addressInput = (
		key: AddressColumn,
		labelKey: ParseKeys,
		extra: { placeholder?: string; required?: boolean } = {},
	) => (
		<div className="space-y-1">
			<Label htmlFor={key}>{t(labelKey)}</Label>
			<Input
				id={key}
				name={addressDirty ? key : undefined}
				defaultValue={doc[key] ?? ""}
				placeholder={extra.placeholder}
				required={addressDirty && extra.required}
				onChange={() => setAddressDirty(true)}
			/>
		</div>
	)

	const [actuals, setActuals] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			services.rows.map((r) => [
				r.serviceCodeId,
				r.actual == null ? "" : String(r.actual),
			]),
		),
	)
	const installed = serviceLines
		.filter((l) => (actuals[l.serviceCodeId] ?? "") !== "")
		.map((l) => ({ ...l, qty: Number(actuals[l.serviceCodeId]) }))
	const shared = services.brigadeNames.length > 0

	const [rows, setRows] = useState<FieldMaterialRow[]>(fieldMaterials)
	const codeOf = new Map(serviceCodes.map((c) => [c.id, c]))
	const qtyOf = (list: MaterialLine[]) =>
		new Map(list.map((m) => [m.serviceCodeId, m.qty]))
	const signedQty = qtyOf(materialsTaken)
	const estimatedQty = qtyOf(estimatedMaterials)
	const tableRows: FieldMaterialsTableRow[] = rows.map((r) => {
		const code = codeOf.get(r.serviceCodeId)
		return {
			...r,
			claroCode: code?.claroCode ?? "—",
			name: code?.name ?? r.serviceCodeId,
			unit: code?.unit ?? null,
			estimated: estimatedQty.get(r.serviceCodeId) ?? 0,
			signed:
				r.source === "WAREHOUSE" ? (signedQty.get(r.serviceCodeId) ?? 0) : 0,
		}
	})

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
				<p className="text-sm font-mono text-muted-foreground">
					{doc.controlNumber}
				</p>
			</div>
			<JobStepRail docId={doc.id} current="FIELD" role={user.role} />

			{doc.status === "SUPERVISOR_APPROVED" && (
				<Callout tone="warn" title={t("docs_field.admin_override")}>
					{null}
				</Callout>
			)}

			<Card>
				<CardHeader>{t("docs_field.photos_label")}</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-xs text-muted-foreground">
						{t("docs_field.photos_saved_hint")}
					</p>
					{PHOTO_BOXES.map(([tag, name, labelKey]) => (
						<PhotoBox
							key={tag}
							name={name}
							labelKey={labelKey}
							photos={photos[tag]}
						/>
					))}
					<BlueprintBox
						docId={doc.id}
						files={blueprints}
						required={blueprintRequired}
					/>
				</CardContent>
			</Card>

			<Form method="post" className="space-y-5">
				<Card>
					<CardHeader>{t("docs_field.address_heading")}</CardHeader>
					<CardContent className="space-y-3">
						<p className="text-sm">
							{t("docs_field.address_on_file", {
								address: doc.jobAddressActual || doc.jobAddressEstimated,
							})}
						</p>
						<div className="grid gap-3 sm:grid-cols-2">
							{addressInput("direccion1", "docs_new.direccion1_label", {
								placeholder: doc.jobAddressEstimated,
								required: true,
							})}
							{addressInput("direccion2", "docs_new.direccion2_label")}
							{addressInput("sector", "docs_new.sector_label")}
							{addressInput("ciudad", "docs_new.ciudad_label")}
							{addressInput("latitud", "docs_new.latitud_label")}
							{addressInput("longitud", "docs_new.longitud_label")}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("docs_field.address_diff_hint")}
						</p>
						{addressCorrections.length > 0 && (
							<div className="space-y-1.5">
								<p className="text-xs font-medium">
									{t("docs_field.address_history_heading")}
								</p>
								<ul className="space-y-1.5">
									{addressCorrections.map((c) => (
										<li
											key={`${c.original}-${c.corrected}-${c.correctedAt}`}
											className="rounded-lg bg-muted p-2 text-xs"
										>
											<span className="text-muted-foreground line-through">
												{c.original}
											</span>
											{" → "}
											<span className="font-medium">{c.corrected}</span>
											<span className="block text-muted-foreground">
												{t(
													c.correctedById === user.id
														? "docs_field.address_edited_by_you"
														: correctorNames[c.correctedById]
															? "docs_field.address_edited_by_name"
															: "docs_field.address_edited_by_other",
													{
														name: correctorNames[c.correctedById],
														when: new Date(c.correctedAt).toLocaleString(),
													},
												)}
											</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</CardContent>
				</Card>

				{services.rows.length > 0 && (
					<Card>
						<CardHeader>{t("docs_field.services_performed_label")}</CardHeader>
						<CardContent className="space-y-2">
							{installed.length > 0 && (
								<input
									type="hidden"
									name="installedServiceLines"
									value={JSON.stringify(installed)}
								/>
							)}
							<div className="overflow-x-auto">
								<table className="w-full text-sm" data-testid="field-services">
									<thead>
										<tr className="border-b text-left text-xs text-muted-foreground">
											<th className="py-1.5 pr-2">
												{t("docs_field.services.code")}
											</th>
											<th className="py-1.5 pr-2">
												{t("docs_field.services.name")}
											</th>
											<th className="py-1.5 pr-2 text-right">
												{t("docs_field.services.estimated")}
											</th>
											<th className="py-1.5 pr-2">
												{t("docs_field.services.actual")}
											</th>
											<th className="py-1.5 pr-2">
												{t("docs_field.services.unit")}
											</th>
											{shared && (
												<th className="py-1.5">
													{t("docs_field.services.brigade")}
												</th>
											)}
										</tr>
									</thead>
									<tbody className="tabular-nums">
										{services.rows.map((r) => (
											<tr
												key={r.serviceCodeId}
												className="border-b last:border-0"
											>
												<td className="py-1.5 pr-2 font-mono text-xs">
													{r.claroCode}
												</td>
												<td className="py-1.5 pr-2">{r.name}</td>
												<td className="py-1.5 pr-2 text-right">
													{r.estimated}
												</td>
												<td className="py-1.5 pr-2">
													<Input
														type="number"
														min={0}
														inputMode="decimal"
														className="w-20"
														aria-label={`${t("docs_field.services.actual")} ${r.claroCode}`}
														value={actuals[r.serviceCodeId] ?? ""}
														onChange={(e) =>
															setActuals({
																...actuals,
																[r.serviceCodeId]: e.target.value,
															})
														}
													/>
												</td>
												<td className="py-1.5 pr-2 text-xs">{r.unit ?? "—"}</td>
												{shared && (
													<td className="py-1.5 text-xs">
														{services.brigadeNames.join(" + ")}
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>{t("docs_field.materials_used_label")}</CardHeader>
					<CardContent className="space-y-3">
						<input
							type="hidden"
							name="fieldMaterials"
							value={JSON.stringify(rows)}
						/>
						{rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("docs_field.materials.empty")}
							</p>
						) : (
							<FieldMaterialsTable
								rows={tableRows}
								onChange={(i, row) =>
									setRows(rows.map((r, j) => (j === i ? row : r)))
								}
							/>
						)}
						<p className="text-xs text-muted-foreground">
							{t("docs_field.materials.hint")}
						</p>
						<select
							aria-label={t("docs_field.materials.add")}
							className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
							value=""
							onChange={(e) => {
								if (!e.target.value) return
								setRows([
									...rows,
									{
										serviceCodeId: e.target.value,
										used: 0,
										returned: 0,
										source: "BRIGADE_STOCK",
									},
								])
							}}
						>
							<option value="">{t("docs_field.materials.add")}</option>
							{serviceCodes.map((c) => (
								<option key={c.id} value={c.id}>
									{c.claroCode} · {c.name}
								</option>
							))}
						</select>
						<div className="space-y-1">
							<Label htmlFor="discrepancyNote">
								{t("docs_field.discrepancy_note_label")}
							</Label>
							<Textarea
								id="discrepancyNote"
								name="discrepancyNote"
								rows={2}
								placeholder={t("docs_field.discrepancy_note_placeholder")}
							/>
							<p className="text-xs text-muted-foreground">
								{t("docs_field.discrepancy_note_hint")}
							</p>
						</div>
					</CardContent>
				</Card>

				<div className="space-y-1">
					<Label htmlFor="fieldNotes">
						{t("docs_field.field_notes_label")}
					</Label>
					<Textarea
						id="fieldNotes"
						name="fieldNotes"
						rows={3}
						placeholder={t("docs_field.field_notes_placeholder")}
						defaultValue={doc.fieldNotes ?? ""}
					/>
				</div>

				{result?.errorKey && (
					<div role="alert">
						<Callout tone="danger" title={t("docs_field.error_title")}>
							{t(result.errorKey)}
						</Callout>
					</div>
				)}
				{result?.ok && !busy && (
					<Callout tone="ok" title={t("docs_field.saved")}>
						{null}
					</Callout>
				)}

				<div className="flex flex-wrap gap-2">
					<Button
						type="submit"
						name="intent"
						value="save"
						variant="outline"
						disabled={busy}
					>
						{t("docs_field.save_progress")}
					</Button>
					<Button
						type="submit"
						name="intent"
						value="continue"
						disabled={busy}
						className="ml-auto"
					>
						{t("docs_field.continue_to_signoff", { n: SIGN_OFF_STEP })}
					</Button>
				</div>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

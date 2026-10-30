import path from "node:path"
import { File01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	data,
	Form,
	redirect,
	useFetcher,
	useNavigation,
	useSubmit,
} from "react-router"
import {
	AddFieldService,
	RemoveAddedService,
} from "~/components/add-field-service"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FieldMaterialsTable,
	type FieldMaterialsTableRow,
} from "~/components/field-materials-table"
import { AddedInFieldLabel } from "~/components/service-lines-table"
import { StepActionBar } from "~/components/step-action-bar"
import { SupervisorStepRail } from "~/components/supervisor-step-rail"
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
} from "~/lib/field-materials"
import { blockingMissing, fieldTargets, nextEmpty } from "~/lib/field-progress"
import {
	type AddressCorrection,
	buildAddressCorrection,
	mergeAddressCorrections,
} from "~/lib/field-update-helpers"
import {
	uploadFileName,
	validateBlueprintFile,
	validateOriginalUpload,
} from "~/lib/file-upload.server"
import { composeJobAddress } from "~/lib/intake-address"
import { isBillableSource } from "~/lib/material-source"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	findPickableServiceCode,
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import {
	installedNotOrdered,
	mergeInstalledPost,
	type ServiceLine,
} from "~/lib/service-lines"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	SUPERVISOR_STAGES,
} from "~/lib/supervisor-stage"
import { photosThatLoad, saveUpload } from "~/lib/uploads.server"
import { cn } from "~/lib/utils"
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
	materialsFromWarehouse: true,
	supervisorApprovedAt: true,
	jafInvoiceGeneratedAt: true,
	avisoNumber: true,
	avisoDocPath: true,
	releasedToFinanceAt: true,
	// The rail's stage: a returned packet is back on the supervisor's steps.
	financeSendBackNotes: true,
	financeVerifiedAt: true,
	pbccRequestSentAt: true,
	blueprintPaths: true,
	claroSupervisor: {
		select: { name: true, requiresBlueprint: true },
	},
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
	// Lines added in the field (Ordered 0) follow the ordered ones.
	const extras = installedNotOrdered(ordered, installed)
	const listed = [...ordered, ...extras]
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
		listed.length > 0
			? db.serviceCode.findMany({
					where: { id: { in: listed.map((l) => l.serviceCodeId) } },
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
			materialsFromWarehouse: doc.materialsFromWarehouse,
		},
		addressCorrections: corrections,
		correctorNames: Object.fromEntries(
			corrections.map((c) => [c.correctedById, nameOf.get(c.correctedById)]),
		),
		photos,
		blueprints: doc.blueprintPaths.map((p) => path.basename(p)),
		blueprintRequired: doc.claroSupervisor?.requiresBlueprint ?? false,
		stage: deriveSupervisorStage(doc, null),
		materialsTaken: taken,
		estimatedMaterials: lines(doc.estimatedMaterials),
		fieldMaterials: fieldMaterialsOrDefault(doc.fieldMaterials, taken),
		serviceLines: ordered,
		installedServiceLines: installed,
		services: {
			rows: [
				...ordered.map((l) => ({
					serviceCodeId: l.serviceCodeId,
					claroCode: l.claroCode,
					name: l.name,
					estimated: l.qty,
					actual:
						installed?.find((i) => i.serviceCodeId === l.serviceCodeId)?.qty ??
						null,
					unit: unitOf.get(l.serviceCodeId) ?? null,
				})),
				...extras.map((l) => ({
					serviceCodeId: l.serviceCodeId,
					claroCode: l.claroCode,
					name: l.name,
					estimated: 0,
					actual: l.qty as number | null,
					unit: unitOf.get(l.serviceCodeId) ?? null,
					...(l.addedInField ? { addedInField: true as const } : {}),
				})),
			],
			brigadeNames: shared
				? doc.assignedCrewIds
						.map((id) => nameOf.get(id))
						.filter((n): n is string => !!n)
				: [],
		},
		serviceCodes: serviceCodesForRole(user.role, codes),
		// "Add service" and its remove (x) stay until the job is signed off
		// (the Pre-cert and the packet are built from the lines from then on).
		addServiceOpen: !doc.jafInvoiceGeneratedAt && !doc.supervisorApprovedAt,
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
			...(l.addedInField === true ? { addedInField: true as const } : {}),
		}))
}

/**
 * "Add service" / its remove (x): a service the order did not have, found by
 * the crew on site, goes on the installed lines flagged `addedInField`
 * (Ordered 0) and from there everywhere the installed lines go. Only until the
 * packet goes to Claro (`jafInvoiceGeneratedAt`, set by the first delivered
 * send, which also locks the invoice lines); the write re-checks it so a send
 * in between wins. Each change is audited with who and when.
 */
async function changeAddedService(
	intent: "add_service" | "remove_added_service",
	form: FormData,
	doc: FieldDoc,
	userId: string,
): Promise<Refusal | { ok: true }> {
	if (doc.jafInvoiceGeneratedAt)
		return refusal("docs_field.errors.service_packet_sent")
	// Admin can still open Field after sign-off; the lines are fixed then.
	if (doc.supervisorApprovedAt)
		return refusal("docs_field.errors.service_signed_off")
	const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
	const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
	const id = String(form.get("serviceCodeId") ?? "")

	let next: ServiceLine[]
	let line: ServiceLine
	if (intent === "add_service") {
		if (!id) return refusal("docs_field.errors.service_not_found")
		if (ordered.some((l) => l.serviceCodeId === id))
			return refusal("docs_field.errors.service_on_order")
		if (
			installedNotOrdered(ordered, installed).some(
				(l) => l.serviceCodeId === id,
			)
		)
			return refusal("docs_field.errors.service_already_added")
		const qty = Number(form.get("qty"))
		if (!Number.isFinite(qty) || qty <= 0)
			return refusal("docs_field.errors.service_qty_invalid")
		const code = await findPickableServiceCode(id)
		if (!code) return refusal("docs_field.errors.service_not_found")
		line = {
			serviceCodeId: code.id,
			claroCode: code.claroCode,
			accountCode: code.accountCode,
			name: code.name,
			qty,
			addedInField: true,
		}
		next = [...installed, line]
	} else {
		// Never a line the order has (even one later put on the order).
		const found = installedNotOrdered(ordered, installed).find(
			(l) => l.serviceCodeId === id && l.addedInField === true,
		)
		if (!found) return refusal("docs_field.errors.service_not_added")
		line = found
		next = installed.filter((l) => l !== found)
	}

	const written = await db.$transaction(async (tx) => {
		const res = await tx.jafInvoice.updateMany({
			where: {
				id: doc.id,
				jafInvoiceGeneratedAt: null,
				supervisorApprovedAt: null,
			},
			data: {
				installedServiceLines: next as unknown as Prisma.InputJsonValue,
				...(doc.fieldStartedAt ? {} : { fieldStartedAt: new Date() }),
			},
		})
		if (res.count === 0) return false
		await tx.auditTrail.create({
			data: {
				docId: doc.id,
				userId,
				action:
					intent === "add_service"
						? "SERVICE_ADDED_IN_FIELD"
						: "SERVICE_REMOVED_IN_FIELD",
				diffJson: { code: line.claroCode, qty: line.qty },
			},
		})
		return true
	})
	// Signed off (or sent, which comes after) between the read and the write.
	if (!written) return refusal("docs_field.errors.service_signed_off")
	return { ok: true }
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
 * Three intents. `back` is `save` that then leaves for the job page, where
 * the earlier steps (Warehouse, Intake) are shown, so going back keeps the
 * draft. `save` writes whatever the post carries (partial, idempotent,
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
	if (intent === "add_service" || intent === "remove_added_service")
		return changeAddedService(intent, form, doc, user.id)
	if (intent !== "save" && intent !== "continue" && intent !== "back")
		throw data({ error: "Unknown intent" }, { status: 400 })

	const photos = PHOTO_FIELDS.flatMap(([name, tag]) =>
		files(form, name).map((file) => ({ file, tag })),
	)
	if (photos.some(({ file }) => !validateOriginalUpload(file).valid))
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
			update.installedServiceLines = mergeInstalledPost(
				parseInstalled(form.get("installedServiceLines") as string),
				(doc.serviceLines as ServiceLine[] | null) ?? [],
				(doc.installedServiceLines as ServiceLine[] | null) ?? null,
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
	if (intent === "continue") {
		// "N/A" counts: the report just can't be blank.
		const report = form.has("fieldNotes")
			? (form.get("fieldNotes") as string).trim()
			: (doc.fieldNotes ?? "")
		if (!report) return refusal("docs_field.errors.field_report_required")
		const stored = await db.photo.findMany({
			where: { docId: doc.id },
			select: { tag: true },
		})
		const has = (tag: PhotoTag) =>
			stored.some((p) => p.tag === tag) || photos.some((p) => p.tag === tag)
		if (!has("BEFORE") || !has("AFTER"))
			return refusal("docs_field.errors.photos_required")
		rows ??= fieldMaterialsOrDefault(doc.fieldMaterials, taken)
		// Billable (WAREHOUSE_ISSUE) use cannot exceed what was issued; extra
		// material is entered under another Source.
		if (exceedsSigned(taken, rows))
			return refusal("docs_field.errors.used_exceeds_took")
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
	if (ops.length > 0) await db.$transaction(ops)

	if (intent === "continue") throw redirect(`/docs/${doc.id}/review`)
	if (intent === "back") throw redirect(`/docs/${doc.id}`)
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
	boxId,
	next = false,
}: {
	name: string
	labelKey: ParseKeys
	photos: { id: string; src: string }[]
	/** Anchor for "jump to the missing box". */
	boxId?: string
	/** This is the box to fill next. */
	next?: boolean
}) {
	const { t } = useTranslation()
	const upload = useFileAutosave()
	const room = Math.max(0, MAX_PHOTOS_PER_BOX - photos.length)
	return (
		<div
			id={boxId}
			className={cn("space-y-2", next && "field-next rounded-lg p-1")}
		>
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
			<div className="grid max-w-md grid-cols-4 gap-2">
				{photos.map((p) => (
					<a
						key={p.id}
						href={p.src}
						target="_blank"
						rel="noreferrer"
						className="block aspect-square overflow-hidden rounded-lg border"
					>
						{/\.pdf$/i.test(p.src) ? (
							<span
								data-testid="photo-pdf"
								className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-xs text-muted-foreground"
							>
								<HugeiconsIcon
									icon={File01Icon}
									className="size-6"
									aria-hidden="true"
								/>
								PDF
							</span>
						) : (
							<img src={p.src} alt="" className="h-full w-full object-cover" />
						)}
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
					accept="image/jpeg,image/png,application/pdf"
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
				accept="image/jpeg,image/png,application/pdf"
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
		stage,
		materialsTaken,
		estimatedMaterials,
		fieldMaterials,
		serviceLines,
		installedServiceLines,
		services,
		serviceCodes,
		addServiceOpen,
	} = loaderData
	const { t } = useTranslation()
	const navigation = useNavigation()
	const submit = useSubmit()
	const formRef = useRef<HTMLFormElement>(null)
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
	// A typed box wins; a line added after the page opened shows its saved qty.
	const actualOf = (r: { serviceCodeId: string; actual: number | null }) =>
		actuals[r.serviceCodeId] ?? (r.actual == null ? "" : String(r.actual))
	// The ordered lines, then those added in the field (Ordered 0).
	const lineOf = new Map(
		[
			...serviceLines,
			...installedNotOrdered(serviceLines, installedServiceLines),
		].map((l) => [l.serviceCodeId, l]),
	)
	const installed = services.rows.flatMap((r) => {
		const line = lineOf.get(r.serviceCodeId)
		const value = actualOf(r)
		return line && value !== "" ? [{ ...line, qty: Number(value) }] : []
	})
	const shared = services.brigadeNames.length > 0

	// The Field report is required; "N/A" is pre-filled so a job with nothing to
	// report does not get stuck on it.
	const [notes, setNotes] = useState(
		doc.fieldNotes?.trim() ? doc.fieldNotes : "N/A",
	)

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
			signed: isBillableSource(r.source)
				? (signedQty.get(r.serviceCodeId) ?? 0)
				: 0,
		}
	})

	const actualId = (serviceCodeId: string) => `actual-${serviceCodeId}`
	const targets = fieldTargets({
		actuals: services.rows.map((r) => ({
			id: actualId(r.serviceCodeId),
			value: actualOf(r),
		})),
		notes,
		beforePhotos: photos.BEFORE.length,
		afterPhotos: photos.AFTER.length,
	})
	const next = nextEmpty(targets)
	const missing = blockingMissing(targets)
	const missingLabels = missing.map((m) =>
		t(
			m.kind === "notes"
				? "docs_field.field_notes_label"
				: m.kind === "before"
					? "docs_field.photos_before_label"
					: "docs_field.photos_after_label",
		),
	)
	const jumpTo = (id: string | undefined) => {
		const el = id ? document.getElementById(id) : null
		if (!el) return
		el.scrollIntoView({ block: "center", behavior: "smooth" })
		const box = el.matches("input, textarea")
			? el
			: el.querySelector<HTMLElement>("input, textarea")
		box?.focus({ preventScroll: true })
	}

	// On a computer the cursor starts in the first empty box. Not on a phone:
	// that would open the keyboard and scroll the page under the supervisor.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the page opens
	useEffect(() => {
		if (!window.matchMedia("(pointer: fine)").matches) return
		const first = nextEmpty(targets)
		if (first && (first.kind === "actual" || first.kind === "notes"))
			jumpTo(first.id)
	}, [])

	// Auto-save the draft a moment after any box changes. Address fields stay out
	// of it: each change to them is logged as a correction with the user's name.
	const draft = useFetcher<ActionResult>()
	const [savedAt, setSavedAt] = useState<Date | null>(null)
	const mounted = useRef(false)
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the boxes change
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true
			return
		}
		if (busy) return
		const timer = setTimeout(() => {
			const form = new FormData()
			form.set("intent", "save")
			if (installed.length > 0)
				form.set("installedServiceLines", JSON.stringify(installed))
			form.set("fieldMaterials", JSON.stringify(rows))
			form.set("fieldNotes", notes)
			draft.submit(form, { method: "post" })
		}, 1000)
		return () => clearTimeout(timer)
	}, [actuals, rows, notes])
	useEffect(() => {
		if (draft.state === "idle" && draft.data?.ok) setSavedAt(new Date())
	}, [draft.state, draft.data])

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
				<p className="text-sm font-mono text-muted-foreground">
					{doc.controlNumber}
				</p>
			</div>
			<SupervisorStepRail
				stage={stage}
				view="FIELD"
				docId={doc.id}
				warehouseSkipped={!doc.materialsFromWarehouse}
			/>

			{doc.status === "SUPERVISOR_APPROVED" && (
				<Callout tone="warn" title={t("docs_field.admin_override")}>
					{null}
				</Callout>
			)}

			<Form ref={formRef} method="post" className="space-y-5">
				{(services.rows.length > 0 || addServiceOpen) && (
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
							{services.rows.length > 0 && (
								<div className="overflow-x-auto">
									<table
										className="w-full text-sm"
										data-testid="field-services"
									>
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
													<td className="py-1.5 pr-2">
														{r.name}
														{"addedInField" in r && r.addedInField === true && (
															<div className="mt-1 flex flex-wrap items-center gap-2">
																<AddedInFieldLabel />
																{addServiceOpen && (
																	<RemoveAddedService
																		serviceCodeId={r.serviceCodeId}
																		claroCode={r.claroCode}
																	/>
																)}
															</div>
														)}
													</td>
													<td className="py-1.5 pr-2 text-right">
														{r.estimated}
													</td>
													<td className="py-1.5 pr-2">
														<Input
															type="number"
															min={0}
															inputMode="decimal"
															id={actualId(r.serviceCodeId)}
															className={cn(
																"field-required w-20",
																next?.id === actualId(r.serviceCodeId) &&
																	"field-next",
															)}
															aria-label={`${t("docs_field.services.actual")} ${r.claroCode}`}
															onKeyDown={(e) => {
																// Enter moves on to the next empty box instead of
																// submitting the form.
																if (e.key !== "Enter") return
																e.preventDefault()
																jumpTo(
																	nextEmpty(targets, actualId(r.serviceCodeId))
																		?.id,
																)
															}}
															value={actualOf(r)}
															onChange={(e) =>
																setActuals({
																	...actuals,
																	[r.serviceCodeId]: e.target.value,
																})
															}
														/>
													</td>
													<td className="py-1.5 pr-2 text-xs">
														{r.unit ?? "—"}
													</td>
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
							)}
							{addServiceOpen && <AddFieldService />}
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
								onRemove={(i) => setRows(rows.filter((_, j) => j !== i))}
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
										source: "TRUCK_STOCK",
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
					</CardContent>
				</Card>

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
								boxId={
									tag === "BEFORE"
										? "photo-box-before"
										: tag === "AFTER"
											? "photo-box-after"
											: undefined
								}
								next={
									tag === "BEFORE"
										? next?.id === "photo-box-before"
										: tag === "AFTER"
											? next?.id === "photo-box-after"
											: false
								}
							/>
						))}
						<BlueprintBox
							docId={doc.id}
							files={blueprints}
							required={blueprintRequired}
						/>
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
						className={cn(
							"field-required",
							next?.id === "fieldNotes" && "field-next",
						)}
						placeholder={t("docs_field.field_notes_placeholder")}
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						onFocus={(e) => {
							// Typing over the pre-filled N/A replaces it.
							if (e.target.value === "N/A") e.target.select()
						}}
					/>
				</div>

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

				<StepActionBar
					status={
						<>
							{missing.length > 0 && (
								<button
									type="button"
									onClick={() => jumpTo(missing[0].id)}
									className="text-left text-xs text-muted-foreground underline-offset-4 hover:underline md:text-sm"
								>
									{t("docs_field.boxes_left", {
										count: missing.length,
										items: missingLabels.join(", "),
									})}
								</button>
							)}
							<p
								className="text-xs text-muted-foreground"
								aria-live="polite"
								data-testid="draft-status"
							>
								{draft.state !== "idle"
									? t("docs_field.draft_saving")
									: draft.data?.errorKey
										? t(draft.data.errorKey)
										: savedAt
											? t("docs_field.draft_saved", {
													time: savedAt.toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
													}),
												})
											: null}
							</p>
						</>
					}
					left={
						<Button
							type="button"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								// Save the draft, then the server sends us to the job page.
								const form = new FormData(formRef.current ?? undefined)
								form.set("intent", "back")
								submit(form, {
									method: "post",
									encType: "multipart/form-data",
								})
							}}
						>
							{t("navigation.back")}
						</Button>
					}
					center={
						<Button
							type="submit"
							name="intent"
							value="save"
							variant="outline"
							disabled={busy}
						>
							{t("docs_field.save_progress")}
						</Button>
					}
					right={
						<Button
							type="submit"
							name="intent"
							value="continue"
							disabled={busy}
							aria-disabled={missing.length > 0 || undefined}
							className={cn("h-10", missing.length > 0 && "opacity-50")}
							onClick={(e) => {
								// Not ready: go to the first missing box instead.
								if (missing.length === 0) return
								e.preventDefault()
								jumpTo(missing[0].id)
							}}
						>
							{t("docs_field.continue_to_signoff", { n: SIGN_OFF_STEP })}
						</Button>
					}
				/>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

import path from "node:path"
import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { JobStepRail } from "~/components/job-step-rail"
import { ServiceLinesTable } from "~/components/service-lines-table"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import {
	exceedsSigned,
	type FieldMaterialRow,
	fieldMaterialsOrDefault,
	parseFieldMaterials,
	quantityDiscrepancies,
	usedForFinance,
} from "~/lib/field-materials"
import {
	type AddressCorrection,
	buildAddressCorrection,
	mergeAddressCorrections,
} from "~/lib/field-update-helpers"
import { validateBlueprintFile, validateFile } from "~/lib/file-upload.server"
import { composeJobAddress } from "~/lib/intake-address"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import type { ServiceLine } from "~/lib/service-lines"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
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

/** Field is open from pickup until sign-off (which locks it). */
const FIELD_OPEN_STATUSES = ["SIGNED", "FIELD_UPDATED"]

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
	if (!FIELD_OPEN_STATUSES.includes(doc.status)) throw redirect(`/docs/${id}`)
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

	const [codes, photoRows] = await Promise.all([
		getActiveMaterialCodes(),
		db.photo.findMany({
			where: { docId: doc.id },
			orderBy: { takenAt: "asc" },
			select: { id: true, tag: true, localPath: true },
		}),
	])
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

function safeName(file: File, i: number): string {
	return `${Date.now()}-${i}-${file.name.replace(/[^\w.-]+/g, "_")}`
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
		update.fieldMaterials = rows
		update.materialsUsed = usedForFinance(rows)
	}

	// Everything is valid: only now write files.
	const photoPaths: { path: string; tag: PhotoTag }[] = []
	for (const [i, { file, tag }] of photos.entries())
		photoPaths.push({
			path: await saveUpload(`photos/${doc.id}`, safeName(file, i), file),
			tag,
		})
	const blueprintPaths: string[] = []
	for (const [i, file] of blueprints.entries())
		blueprintPaths.push(
			await saveUpload(`blueprints/${doc.id}`, safeName(file, i), file),
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
	if (discrepancies.length > 0)
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

/**
 * Interim screen over the supervisor loader/action (Task 7 replaces it with
 * the mockup layout and autosave): plain form, "Save progress" and
 * "Continue to Sign off".
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
		fieldMaterials,
		serviceLines,
		installedServiceLines,
		serviceCodes,
	} = loaderData
	const { t } = useTranslation()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const error = actionData as { errorKey?: ParseKeys; ok?: true } | undefined
	const [rows, setRows] = useState<FieldMaterialRow[]>(fieldMaterials)
	const signed = new Map(materialsTaken.map((m) => [m.serviceCodeId, m.qty]))
	const codeOf = (id: string) => serviceCodes.find((c) => c.id === id)

	function setRow(i: number, patch: Partial<FieldMaterialRow>) {
		setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
	}

	const photoBoxes: [PhotoTag, string, ParseKeys][] = [
		["BEFORE", "photosBefore", "docs_field.photos_before_label"],
		["DURING", "photosDuring", "docs_field.photos_during_label"],
		["AFTER", "photosAfter", "docs_field.photos_after_label"],
	]

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-xl font-semibold">{t("docs_field.title")}</h1>
				<p className="text-sm font-mono text-muted-foreground">
					{doc.controlNumber}
				</p>
			</div>
			<JobStepRail docId={doc.id} current="FIELD" role={user.role} />

			{error?.errorKey && (
				<div role="alert">
					<Callout tone="danger" title={t("docs_field.error_title")}>
						{t(error.errorKey)}
					</Callout>
				</div>
			)}
			{error?.ok && (
				<Callout tone="ok" title={t("docs_field.saved")}>
					{null}
				</Callout>
			)}

			<Form
				method="post"
				encType="multipart/form-data"
				className="space-y-4"
				// A new key after each save clears the file inputs.
				key={`${photos.BEFORE.length}-${photos.DURING.length}-${photos.AFTER.length}-${blueprints.length}`}
			>
				<div className="border rounded-lg p-3 space-y-3">
					<div className="space-y-1">
						<Label htmlFor="direccion1">{t("docs_new.direccion1_label")}</Label>
						<Input
							id="direccion1"
							name="direccion1"
							defaultValue={doc.direccion1 ?? doc.jobAddressEstimated}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="sector">{t("docs_new.sector_label")}</Label>
						<Input id="sector" name="sector" defaultValue={doc.sector ?? ""} />
					</div>
					{addressCorrections.length > 0 && (
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
					)}
				</div>

				{photoBoxes.map(([tag, name, label]) => (
					<div key={tag} className="border rounded-lg p-3 space-y-2">
						<Label htmlFor={name}>{t(label)}</Label>
						<div className="flex flex-wrap gap-2">
							{photos[tag].map((p) => (
								<img
									key={p.id}
									src={p.src}
									alt=""
									className="h-20 w-20 rounded object-cover"
								/>
							))}
						</div>
						<input
							id={name}
							name={name}
							type="file"
							accept="image/*"
							multiple
						/>
					</div>
				))}

				<div className="border rounded-lg p-3 space-y-2">
					<Label htmlFor="blueprint">{t("docs_field.blueprint_label")}</Label>
					{blueprintRequired && (
						<p className="text-xs text-muted-foreground">
							{t("docs_field.blueprint_required_hint")}
						</p>
					)}
					<ul className="text-sm">
						{blueprints.map((b) => (
							<li key={b}>{b}</li>
						))}
					</ul>
					<input
						id="blueprint"
						name="blueprint"
						type="file"
						accept="application/pdf,image/*"
						multiple
					/>
				</div>

				{serviceLines.length > 0 && (
					<div className="border rounded-lg p-3 space-y-2">
						<Label>{t("docs_field.services_performed_label")}</Label>
						<ServiceLinesTable
							lines={serviceLines}
							installed={installedServiceLines ?? undefined}
							editableName="installedServiceLines"
						/>
					</div>
				)}

				<div className="border rounded-lg p-3 space-y-2">
					<Label>{t("docs_field.materials_used_label")}</Label>
					<input
						type="hidden"
						name="fieldMaterials"
						value={JSON.stringify(rows)}
					/>
					<table className="w-full text-sm">
						<thead className="text-xs text-muted-foreground">
							<tr>
								<th className="text-left">
									{t("docs_field.materials.material")}
								</th>
								<th>{t("docs_field.materials.signed")}</th>
								<th>{t("docs_field.materials.used")}</th>
								<th>{t("docs_field.materials.returned")}</th>
								<th>{t("docs_field.materials.source")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r, i) => (
								<tr key={`${r.serviceCodeId}-${r.source}`}>
									<td>{codeOf(r.serviceCodeId)?.name ?? r.serviceCodeId}</td>
									<td className="text-center">
										{signed.get(r.serviceCodeId) ?? 0}
									</td>
									<td>
										<Input
											type="number"
											min={0}
											aria-label={t("docs_field.materials.used")}
											value={r.used}
											onChange={(e) =>
												setRow(i, { used: Number(e.target.value) })
											}
										/>
									</td>
									<td>
										<Input
											type="number"
											min={0}
											aria-label={t("docs_field.materials.returned")}
											value={r.returned}
											onChange={(e) =>
												setRow(i, { returned: Number(e.target.value) })
											}
										/>
									</td>
									<td>
										<select
											aria-label={t("docs_field.materials.source")}
											value={r.source}
											onChange={(e) =>
												setRow(i, {
													source: e.target.value as FieldMaterialRow["source"],
												})
											}
										>
											<option value="WAREHOUSE">
												{t("docs_field.materials.source_warehouse")}
											</option>
											<option value="BRIGADE_STOCK">
												{t("docs_field.materials.source_brigade_stock")}
											</option>
										</select>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div>
					<Label htmlFor="discrepancyNote">
						{t("docs_field.discrepancy_note_label")}
					</Label>
					<Textarea
						id="discrepancyNote"
						name="discrepancyNote"
						rows={2}
						placeholder={t("docs_field.discrepancy_note_placeholder")}
					/>
				</div>
				<div>
					<Label htmlFor="fieldNotes">
						{t("docs_field.field_notes_label")}
					</Label>
					<Textarea
						id="fieldNotes"
						name="fieldNotes"
						rows={3}
						defaultValue={doc.fieldNotes ?? ""}
					/>
				</div>

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
					<Button type="submit" name="intent" value="continue" disabled={busy}>
						{t("docs_field.continue_to_signoff")}
					</Button>
				</div>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

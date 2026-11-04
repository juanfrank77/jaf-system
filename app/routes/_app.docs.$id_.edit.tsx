import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { CrewPicker } from "~/components/crew-picker"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	MaterialsSourceChoice,
	PrefieldNeededChoice,
} from "~/components/intake-choices"
import { MaterialPicker } from "~/components/material-picker"
import { ServicePicker } from "~/components/service-picker"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { Textarea } from "~/components/ui/textarea"
import { assignRejection, toPickerBrigades } from "~/lib/brigade-picker"
import {
	assignBrigadesOrThrow,
	BRIGADE_INVALID,
	BrigadeAssignError,
	lastWorkedByBrigade,
	pickerViewer,
} from "~/lib/brigade-picker.server"
import {
	assignedBrigadeIds,
	buildCrewAssignment,
	parseBrigadeIds,
	readHistory,
} from "~/lib/crew-assignment"
import { readCrewLines, sumCrewLines } from "~/lib/crew-field"
import { db } from "~/lib/db.server"
import {
	type MaterialsChoice,
	type PrefieldChoice,
	parseIntakeAnswers,
} from "~/lib/intake-answers"
import { isEditableStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { isReturned } from "~/lib/returned-packet"
import {
	getActiveMaterialCodes,
	isPriceBlind,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import {
	assertDocInSupervisorScope,
	assignableBrigadesWhere,
} from "~/lib/supervisor-scope"
import { toNumberPrice } from "~/lib/utils"
import {
	MAX_SUPERVISOR_EDITS,
	supervisorEditsLeft,
	WORK_ORDER_EDITED,
} from "~/lib/work-order-edits"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.edit"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data ? `${data.doc.controlNumber} — Edit — JAF Ops` : "JAF Ops",
	},
]

/** Edits a supervisor has used on this job; null when the role is not limited. */
async function supervisorEditsUsed(role: string, docId: string) {
	if (role !== "SUPERVISOR") return null
	return db.auditTrail.count({
		where: { docId, action: WORK_ORDER_EDITED },
	})
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: { select: { id: true, name: true } },
			brigade: { select: { area: true } },
		},
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	// Sent back by Finance: nothing stays locked, the supervisor can change anything.
	if (!isEditableStatus(doc.status, doc) && !isReturned(doc))
		throw redirect(`/docs/${params.id}`)

	const brigadeArgs = await assignableBrigadesWhere(db, user)
	const viewer = await pickerViewer(db, user)
	const [serviceCodes, brigadeRows, lastWorked] = await Promise.all([
		getActiveMaterialCodes(),
		db.brigade.findMany({
			where: brigadeArgs.where,
			orderBy: [{ area: "asc" }, { name: "asc" }],
			select: {
				id: true,
				name: true,
				area: true,
				code: true,
				leadName: true,
				...brigadeArgs.select,
			},
			take: brigadeArgs.take,
		}),
		lastWorkedByBrigade(db),
	])
	const brigades = toPickerBrigades(brigadeRows, viewer, lastWorked)
	// A crew already on the job stays on the page as a selected card even when
	// the picker rules would not list it (e.g. inactive, for an Admin).
	const missing = assignedBrigadeIds(doc).filter(
		(id) => !brigades.some((b) => b.id === id),
	)
	if (missing.length > 0) {
		const extra = await db.brigade.findMany({
			where: { id: { in: missing }, isEquipmentAccount: false },
			select: {
				id: true,
				name: true,
				area: true,
				code: true,
				leadName: true,
			},
		})
		for (const b of extra)
			brigades.push({
				...b,
				state: "own",
				active: true,
				supervisorName: null,
				lastWorkedAt: lastWorked.get(b.id)?.toISOString() ?? null,
			})
	}
	const lineIds = ((doc.serviceLines as ServiceLine[] | null) ?? []).map(
		(l) => l.serviceCodeId,
	)
	const lineCodes =
		lineIds.length > 0
			? await db.serviceCode.findMany({
					where: { id: { in: lineIds } },
					select: { id: true, unit: true, unitPrice: true },
				})
			: []
	const showPrices = !isPriceBlind(user.role)
	const serviceLineMeta = Object.fromEntries(
		lineCodes.map((c) => [
			c.id,
			showPrices
				? { unit: c.unit, unitPrice: toNumberPrice(c.unitPrice) }
				: { unit: c.unit },
		]),
	)
	const editsUsed = await supervisorEditsUsed(user.role, doc.id)
	return {
		doc,
		user,
		editsUsed,
		serviceLineMeta,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		showPrices,
		brigades,
		assignedBrigadeIds: assignedBrigadeIds(doc),
		intakeAnswers: {
			materials: (doc.materialsFromWarehouse ? "yes" : "no") as MaterialsChoice,
			materialsReason: doc.materialsReason,
			prefield: (doc.prefieldNeeded
				? "needed"
				: "not_needed") as PrefieldChoice,
		},
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { brigade: { select: { area: true } } },
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const returned = isReturned(doc)
	if (!isEditableStatus(doc.status, doc) && !returned) {
		// A no-warehouse job stops being editable once Field starts.
		if (doc.status === "SIGNED" && !doc.materialsFromWarehouse)
			return { errorKey: "docs_edit.errors.field_started" }
		throw redirect(`/docs/${params.id}`)
	}

	const editsUsed = await supervisorEditsUsed(user.role, doc.id)
	if (!returned && editsUsed !== null && supervisorEditsLeft(editsUsed) === 0)
		return { errorKey: "docs_edit.errors.limit_reached" }

	const form = await request.formData()
	const jobType = (form.get("jobType") as string).trim()
	const jobAddressEstimated = (form.get("jobAddressEstimated") as string).trim()
	const jobDescription =
		(form.get("jobDescription") as string | null)?.trim() || null
	const brigadeIds = parseBrigadeIds(form)
	const materialsRaw = (form.get("materials") as string) || "[]"

	let estimatedMaterials: { serviceCodeId: string; qty: number }[] = []
	try {
		estimatedMaterials = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_edit.errors.invalid_materials" }
	}

	let serviceLines: ServiceLine[] = []
	try {
		serviceLines = parseServiceLines(form.get("serviceLines") as string | null)
	} catch {
		return { errorKey: "docs_edit.errors.invalid_service_lines" }
	}

	if (!jobType || !jobAddressEstimated || brigadeIds.length === 0) {
		return { errorKey: "docs_edit.errors.missing_fields" }
	}

	const answers = parseIntakeAnswers(form)
	if (!answers.ok) return { errorKey: answers.errorKey }
	const { materialsFromWarehouse, materialsReason, prefieldNeeded } =
		answers.value
	const toNoWarehouse = doc.materialsFromWarehouse && !materialsFromWarehouse
	const toWarehouse = !doc.materialsFromWarehouse && materialsFromWarehouse
	// Once the warehouse has prepped, the materials are already staged for
	// this job; switching away would strand them.
	if (!returned && toNoWarehouse && doc.status !== "CREATED")
		return { errorKey: "docs_edit.errors.warehouse_started" }
	// isEditableStatus already refuses a no-warehouse job once Field started.
	if (toWarehouse && doc.fieldStartedAt)
		return { errorKey: "docs_edit.errors.field_started" }
	// No warehouse: straight to Field with no materials baseline. Back to the
	// warehouse: the job waits for prep again.
	const status = returned
		? doc.status
		: toNoWarehouse
			? "SIGNED"
			: toWarehouse
				? "CREATED"
				: doc.status
	if (!materialsFromWarehouse) estimatedMaterials = []
	const answersChanged =
		materialsFromWarehouse !== doc.materialsFromWarehouse ||
		materialsReason !== doc.materialsReason ||
		prefieldNeeded !== doc.prefieldNeeded
	// A generated but unsent package no longer matches the answers; the send
	// stays disabled until it is generated again. A sent one is left as sent.
	const markPacketStale =
		answersChanged && !!doc.jafInvoicePdfPath && !doc.jafInvoiceGeneratedAt

	const viewer = await pickerViewer(db, user)
	// Brigades already on the job pass through unchanged (no activation, no
	// event, no block even if since terminated or moved to someone else): the
	// picker rules apply only to the ones this edit adds.
	const kept = assignedBrigadeIds(doc)
	const addedIds = brigadeIds.filter((id) => !kept.includes(id))
	const brigades = await Promise.all(
		brigadeIds.map((id) => db.brigade.findUnique({ where: { id } })),
	)
	// An early refusal before anything is written; `assignBrigadesOrThrow`
	// re-checks (and activates) the added ones inside the save transaction.
	for (const brigade of brigades) {
		if (!brigade) return { errorKey: "docs_edit.errors.brigade_invalid" }
		if (!addedIds.includes(brigade.id)) continue
		const rejection = assignRejection(brigade, viewer)
		if (rejection === "invalid")
			return { errorKey: "docs_edit.errors.brigade_invalid" }
	}
	const { brigadeId, assignedCrewIds } = buildCrewAssignment(
		brigades as NonNullable<(typeof brigades)[number]>[],
	)
	const crewChanged = JSON.stringify(brigadeIds) !== JSON.stringify(kept)

	const materialsChanged =
		JSON.stringify(estimatedMaterials) !==
		JSON.stringify(doc.estimatedMaterials ?? [])

	try {
		await db.$transaction(async (tx) => {
			// Activate & assign succeeds or fails with the edit.
			if (addedIds.length > 0)
				await assignBrigadesOrThrow(tx, {
					docId: doc.id,
					viewer,
					brigadeIds: addedIds,
				})
			await tx.jafInvoice.update({
				where: { id: params.id },
				data: {
					jobType,
					jobAddressEstimated,
					jobDescription,
					estimatedMaterials,
					materialsFromWarehouse,
					materialsReason,
					prefieldNeeded,
					...(status !== doc.status && { status }),
					...(markPacketStale && { packetStale: true }),
					serviceLines,
					brigadeId,
					assignedCrewIds,
					// A crew taken off the job takes its card with it.
					...(crewChanged &&
						readCrewLines(doc.crewServiceLines).length > 0 &&
						(() => {
							const remaining = readCrewLines(doc.crewServiceLines).filter(
								(c) => brigadeIds.includes(c.brigadeId),
							)
							return {
								crewServiceLines: remaining as unknown as Prisma.InputJsonValue,
								installedServiceLines: sumCrewLines(
									remaining,
								) as unknown as Prisma.InputJsonValue,
							}
						})()),
					// Only record a new assignment when the brigades actually
					// changed; a plain re-save leaves the history alone.
					...(crewChanged && {
						crewAssignmentHistory: [
							...(readHistory(
								doc.crewAssignmentHistory,
							) as Prisma.InputJsonObject[]),
							{
								userIds: assignedCrewIds,
								brigadeId,
								brigadeIds,
								assignedById: user.id,
								assignedAt: new Date().toISOString(),
							},
						],
					}),
					// PRD §2.7: editing materials after prep started → flag for re-confirm.
					prepChangedSincePrep:
						doc.status === "PREPPED" && materialsChanged
							? true
							: doc.prepChangedSincePrep,
				},
			})
			await tx.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "WORK_ORDER_EDITED",
					diffJson: {
						fields: [
							"jobType",
							"jobAddressEstimated",
							"jobDescription",
							"estimatedMaterials",
							"serviceLines",
							"brigadeId",
							"assignedCrewIds",
							"materialsFromWarehouse",
							"materialsReason",
							"prefieldNeeded",
						],
						brigadeIds,
						materialsChanged,
						answersChanged,
						...(materialsFromWarehouse !== doc.materialsFromWarehouse && {
							materialsFromWarehouse: {
								before: doc.materialsFromWarehouse,
								after: materialsFromWarehouse,
							},
						}),
						...(materialsReason !== doc.materialsReason && {
							materialsReason: {
								before: doc.materialsReason,
								after: materialsReason,
							},
						}),
						...(prefieldNeeded !== doc.prefieldNeeded && {
							prefieldNeeded: {
								before: doc.prefieldNeeded,
								after: prefieldNeeded,
							},
						}),
						...(status !== doc.status && {
							status: { before: doc.status, after: status },
						}),
						...(markPacketStale && { packetStale: true }),
						prepChangedSincePrep: doc.status === "PREPPED" && materialsChanged,
					},
				},
			})
			const warehouseMessage =
				doc.status === "PREPPED" && materialsChanged
					? `Job ${doc.controlNumber} estimated materials changed after prep — please re-confirm.`
					: toWarehouse
						? `Job ${doc.controlNumber} — ${jobType} at ${jobAddressEstimated} now takes materials from the warehouse. Please prepare materials.`
						: null
			if (warehouseMessage) {
				const warehouseUsers = await tx.user.findMany({
					where: { role: "WAREHOUSE", active: true },
				})
				await Promise.all(
					warehouseUsers.map((w) =>
						tx.notification.create({
							data: {
								userId: w.id,
								docId: params.id,
								message: warehouseMessage,
							},
						}),
					),
				)
			}
		})
	} catch (e) {
		if (e instanceof BrigadeAssignError)
			return {
				errorKey:
					e.errorKey === BRIGADE_INVALID
						? "docs_edit.errors.brigade_invalid"
						: e.errorKey,
			}
		throw e
	}

	throw redirect(`/docs/${params.id}`)
}

export default function EditDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		editsUsed,
		serviceCodes,
		serviceLineMeta,
		showPrices,
		brigades,
		assignedBrigadeIds,
		intakeAnswers,
	} = loaderData
	const [materialsChoice, setMaterialsChoice] = useState<MaterialsChoice | "">(
		intakeAnswers.materials,
	)
	const [prefieldChoice, setPrefieldChoice] = useState<PrefieldChoice | "">(
		intakeAnswers.prefield,
	)
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()
	const editsLeft = editsUsed === null ? null : supervisorEditsLeft(editsUsed)
	if (editsLeft === 0)
		return (
			<div className="space-y-4">
				<PageHeader title={t("docs_edit.title")} />
				<Card>
					<CardContent className="space-y-3">
						<p role="alert" className="text-sm text-status-danger">
							{t("docs_edit.limit_reached", { max: MAX_SUPERVISOR_EDITS })}
						</p>
						<Link
							to={`/docs/${doc.id}`}
							className={buttonVariants({ variant: "outline" })}
						>
							{t("docs_edit.back_to_work_order")}
						</Link>
					</CardContent>
				</Card>
			</div>
		)
	return (
		<div className="space-y-4">
			<PageHeader title={t("docs_edit.title")} />
			{editsLeft !== null && (
				<p className="text-sm text-muted-foreground">
					{t("docs_edit.edits_left", {
						left: editsLeft,
						max: MAX_SUPERVISOR_EDITS,
					})}
				</p>
			)}
			<Form method="post">
				<Card>
					<CardContent className="space-y-5">
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<Label htmlFor="workOrderNumber">
									{t("docs_new.work_order_label")}
								</Label>
								<Input
									id="workOrderNumber"
									value={doc.controlNumber}
									readOnly
									disabled
									className="mt-1 font-mono"
								/>
							</div>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
								<Input
									id="jobType"
									name="jobType"
									defaultValue={doc.jobType}
									required
									className="mt-1"
								/>
							</div>
							<div>
								<Label htmlFor="jobAddressEstimated">
									{t("docs_new.job_address_label")}
								</Label>
								<Input
									id="jobAddressEstimated"
									name="jobAddressEstimated"
									defaultValue={doc.jobAddressEstimated}
									required
									className="mt-1"
								/>
								<Hint>{t("docs_new.job_address_hint")}</Hint>
							</div>
						</div>
						<div>
							<Label htmlFor="jobDescription">
								{t("docs_edit.job_description_label")}
							</Label>
							<Textarea
								id="jobDescription"
								name="jobDescription"
								rows={2}
								defaultValue={doc.jobDescription ?? ""}
								className="mt-1"
							/>
						</div>
						<div>
							<Label>{t("docs_new.assigned_crew_label")}</Label>
							<div className="mt-1">
								<CrewPicker
									brigades={brigades}
									initialSelected={assignedBrigadeIds}
								/>
							</div>
							<Hint>{t("docs_new.crew_hint")}</Hint>
						</div>
						<div>
							<Label>{t("docs_edit.service_codes_label")}</Label>
							<div className="mt-1">
								<ServicePicker
									initialLines={(doc.serviceLines as ServiceLine[]) ?? []}
									initialMeta={serviceLineMeta}
									showPrices={showPrices}
								/>
							</div>
						</div>
						<MaterialsSourceChoice
							value={materialsChoice}
							onChange={setMaterialsChoice}
							defaultReason={intakeAnswers.materialsReason}
						>
							<div>
								<Label>{t("docs_new.estimated_materials_label")}</Label>
								<Hint>{t("docs_new.estimated_materials_hint")}</Hint>
								<div className="mt-1">
									<MaterialPicker
										materials={serviceCodes}
										initialItems={
											(doc.estimatedMaterials as {
												serviceCodeId: string
												qty: number
											}[]) ?? []
										}
									/>
								</div>
							</div>
						</MaterialsSourceChoice>
						<PrefieldNeededChoice
							value={prefieldChoice}
							onChange={setPrefieldChoice}
						/>
						{error?.errorKey && (
							<p className="text-sm text-status-danger">{t(error.errorKey)}</p>
						)}
						<Button type="submit">{t("docs_edit.submit")}</Button>
					</CardContent>
				</Card>
			</Form>
		</div>
	)
}

function Hint({ children }: { children: React.ReactNode }) {
	return <p className="mt-1 text-xs text-muted-foreground">{children}</p>
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

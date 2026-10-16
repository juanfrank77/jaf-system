import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { CrewPicker } from "~/components/crew-picker"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialPicker } from "~/components/material-picker"
import { ServicePicker } from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { Textarea } from "~/components/ui/textarea"
import {
	assignedBrigadeIds,
	buildCrewAssignment,
	parseBrigadeIds,
	readHistory,
} from "~/lib/crew-assignment"
import { db } from "~/lib/db.server"
import { isEditableStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	isPriceBlind,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import {
	assertDocInSupervisorScope,
	assignableBrigadesWhere,
	isBrigadeInSupervisorScope,
} from "~/lib/supervisor-scope"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.edit"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data ? `${data.doc.controlNumber} — Edit — JAF Ops` : "JAF Ops",
	},
]

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
	if (!isEditableStatus(doc.status)) throw redirect(`/docs/${params.id}`)

	const brigadeArgs = await assignableBrigadesWhere(db, user)
	const [serviceCodes, brigades] = await Promise.all([
		getActiveMaterialCodes(),
		db.brigade.findMany({
			where: brigadeArgs.where,
			orderBy: [{ area: "asc" }, { name: "asc" }],
			select: { id: true, name: true, area: true, code: true, leadName: true },
			take: brigadeArgs.take,
		}),
	])
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
	return {
		doc,
		user,
		serviceLineMeta,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		showPrices,
		brigades,
		assignedBrigadeIds: assignedBrigadeIds(doc),
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
	if (!isEditableStatus(doc.status)) throw redirect(`/docs/${params.id}`)

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

	const brigades = await Promise.all(
		brigadeIds.map((id) => db.brigade.findUnique({ where: { id } })),
	)
	for (const brigade of brigades) {
		if (!brigade) return { errorKey: "docs_edit.errors.brigade_invalid" }
		if (
			user.role === "SUPERVISOR" &&
			!(await isBrigadeInSupervisorScope(db, user.id, brigade))
		) {
			return { errorKey: "docs_edit.errors.brigade_invalid" }
		}
	}
	const { brigadeId, assignedCrewIds } = buildCrewAssignment(
		brigades as NonNullable<(typeof brigades)[number]>[],
	)
	const crewChanged =
		JSON.stringify(brigadeIds) !== JSON.stringify(assignedBrigadeIds(doc))

	const materialsChanged =
		JSON.stringify(estimatedMaterials) !==
		JSON.stringify(doc.estimatedMaterials ?? [])

	await db.$transaction(async (tx) => {
		await tx.jafInvoice.update({
			where: { id: params.id },
			data: {
				jobType,
				jobAddressEstimated,
				jobDescription,
				estimatedMaterials,
				serviceLines,
				brigadeId,
				assignedCrewIds,
				// Only record a new assignment when the brigades (or the lead)
				// actually changed; a plain re-save leaves the history alone.
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
					],
					brigadeIds,
					materialsChanged,
					prepChangedSincePrep: doc.status === "PREPPED" && materialsChanged,
				},
			},
		})
		if (doc.status === "PREPPED" && materialsChanged) {
			const warehouseUsers = await tx.user.findMany({
				where: { role: "WAREHOUSE", active: true },
			})
			await Promise.all(
				warehouseUsers.map((w) =>
					tx.notification.create({
						data: {
							userId: w.id,
							docId: params.id,
							message: `Job ${doc.controlNumber} estimated materials changed after prep — please re-confirm.`,
						},
					}),
				),
			)
		}
	})

	throw redirect(`/docs/${params.id}`)
}

export default function EditDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		serviceCodes,
		serviceLineMeta,
		showPrices,
		brigades,
		assignedBrigadeIds,
	} = loaderData
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("docs_edit.title")} />
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

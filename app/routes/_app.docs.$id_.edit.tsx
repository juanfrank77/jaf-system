import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServicePicker } from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { isEditableStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import {
	assertDocInSupervisorScope,
	assignableBrigadesWhere,
	isBrigadeInSupervisorScope,
} from "~/lib/supervisor-scope"
import { toNumberPrice } from "~/lib/utils"
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
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		brigades,
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
	const brigadeId = (form.get("brigadeId") as string | null)?.trim() || null
	const avisoNumber = (form.get("avisoNumber") as string | null)?.trim() || null
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

	if (!jobType || !jobAddressEstimated || !brigadeId) {
		return { errorKey: "docs_edit.errors.missing_fields" }
	}

	const brigade = await db.brigade.findUnique({
		where: { id: brigadeId },
	})
	if (!brigade) return { errorKey: "docs_edit.errors.brigade_invalid" }
	if (
		user.role === "SUPERVISOR" &&
		!(await isBrigadeInSupervisorScope(db, user.id, brigade))
	) {
		return { errorKey: "docs_edit.errors.brigade_invalid" }
	}
	const assignedCrewIds = brigade.memberIds

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
				avisoNumber,
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
						"avisoNumber",
					],
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

export default function EditDoc({ loaderData }: Route.ComponentProps) {
	const { doc, serviceCodes, brigades } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_edit.title")}</h1>
			<p className="font-mono text-sm text-muted-foreground">
				{doc.controlNumber}
			</p>
			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
					<Input
						id="jobType"
						name="jobType"
						defaultValue={doc.jobType}
						required
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
					/>
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
					/>
				</div>
				<div>
					<Label htmlFor="avisoNumber">
						{t("docs_new.aviso_number_label")}
					</Label>
					<Input
						id="avisoNumber"
						name="avisoNumber"
						defaultValue={doc.avisoNumber ?? ""}
						placeholder="10333185"
					/>
				</div>
				<div>
					<Label>{t("docs_edit.service_codes_label")}</Label>
					<ServicePicker
						initialLines={(doc.serviceLines as ServiceLine[]) ?? []}
					/>
				</div>
				<div>
					<Label>{t("docs_new.estimated_materials_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems
							serviceCodes={serviceCodes}
							initialItems={
								(doc.estimatedMaterials as {
									serviceCodeId: string
									qty: number
								}[]) ?? []
							}
						/>
					</div>
				</div>
				<div>
					<Label htmlFor="brigadeId">{t("docs_edit.select_crew_label")}</Label>
					<select
						id="brigadeId"
						name="brigadeId"
						required
						defaultValue={doc.brigadeId ?? ""}
						className="mt-1 w-full border rounded-md h-9 px-2 text-sm bg-card"
					>
						<option value="" disabled>
							{t("docs_edit.select_crew_placeholder")}
						</option>
						{brigades.map((b) => (
							<option key={b.id} value={b.id}>
								{b.name}
								{b.code ? ` · ${b.code}` : ""}
								{b.area ? ` (${b.area})` : ""}
							</option>
						))}
					</select>
				</div>
				<Button type="submit" className="w-full">
					{t("docs_edit.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

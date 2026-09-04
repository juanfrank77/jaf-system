import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { isEditableStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
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
		},
	})
	if (!isEditableStatus(doc.status)) throw redirect(`/docs/${params.id}`)

	const serviceCodes = await getActiveMaterialCodes()
	const crew = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		take: 100,
	})
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		crew,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!isEditableStatus(doc.status)) throw redirect(`/docs/${params.id}`)

	const form = await request.formData()
	const jobType = (form.get("jobType") as string).trim()
	const jobAddressEstimated = (form.get("jobAddressEstimated") as string).trim()
	const assignedCrewIds = form.getAll("assignedCrewIds") as string[]
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

	if (!jobType || !jobAddressEstimated || assignedCrewIds.length === 0) {
		return { errorKey: "docs_edit.errors.missing_fields" }
	}

	const materialsChanged =
		JSON.stringify(estimatedMaterials) !==
		JSON.stringify(doc.estimatedMaterials ?? [])

	await db.$transaction(async (tx) => {
		await tx.jafInvoice.update({
			where: { id: params.id },
			data: {
				jobType,
				jobAddressEstimated,
				estimatedMaterials,
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
						"estimatedMaterials",
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
	const { doc, serviceCodes, crew } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_edit.title")}</h1>
			<p className="font-mono text-sm text-slate-500">{doc.controlNumber}</p>
			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
					<Input
						id="jobType"
						name="jobType"
						defaultValue={(doc as any).jobType}
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
						defaultValue={(doc as any).jobAddressEstimated}
						required
					/>
				</div>
				<div>
					<Label htmlFor="avisoNumber">
						{t("docs_new.aviso_number_label")}
					</Label>
					<Input
						id="avisoNumber"
						name="avisoNumber"
						defaultValue={(doc as any).avisoNumber || ""}
						placeholder="10333185"
					/>
				</div>
				<div>
					<Label>{t("docs_new.assigned_crew_label")}</Label>
					<div className="space-y-1 mt-1">
						{crew.map((c) => (
							<label key={c.id} className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									name="assignedCrewIds"
									value={c.id}
									defaultChecked={(doc as any).assignedCrewIds?.includes(c.id)}
								/>
								{c.name}
							</label>
						))}
					</div>
				</div>
				<div>
					<Label>{t("docs_new.estimated_materials_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems
							serviceCodes={serviceCodes as any}
							initialItems={(doc as any).estimatedMaterials as any[]}
						/>
					</div>
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

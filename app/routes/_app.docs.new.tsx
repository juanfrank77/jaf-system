import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServicePicker } from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Document — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const [materials, brigades] = await Promise.all([
		getActiveMaterialCodes(),
		db.brigade.findMany({
			where: { active: true },
			orderBy: [{ area: "asc" }, { name: "asc" }],
			select: { id: true, name: true, area: true, code: true, leadName: true },
		}),
	])
	return {
		user,
		serviceCodes: materials.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		brigades,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const form = await request.formData()

	const jobType = ((form.get("jobType") as string) || "").trim()
	const jobAddressEstimated = (
		(form.get("jobAddressEstimated") as string) || ""
	).trim()
	const jobDescription =
		(form.get("jobDescription") as string | null)?.trim() || null
	const brigadeId = (form.get("brigadeId") as string | null)?.trim() || null
	const materialsRaw = (form.get("materials") as string) || "[]"

	let estimatedMaterials: { serviceCodeId: string; qty: number }[] = []
	try {
		estimatedMaterials = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_new.errors.invalid_materials" }
	}

	let serviceLines: ServiceLine[] = []
	try {
		serviceLines = parseServiceLines(form.get("serviceLines") as string | null)
	} catch {
		return { errorKey: "docs_new.errors.invalid_service_lines" }
	}

	if (!jobType || !jobAddressEstimated || !brigadeId) {
		return { errorKey: "docs_new.errors.missing_fields" }
	}

	const brigade = await db.brigade.findUniqueOrThrow({
		where: { id: brigadeId },
	})
	const assignedCrewIds = brigade.memberIds
	const controlNumber = await generateControlNumber()
	const warehouse = await db.user.findMany({
		where: { role: "WAREHOUSE", active: true },
	})

	await db.$transaction(async (tx) => {
		const doc = await tx.jafInvoice.create({
			data: {
				controlNumber,
				status: "CREATED",
				jobType,
				jobAddressEstimated,
				jobDescription,
				estimatedMaterials,
				serviceLines,
				brigadeId,
				assignedCrewIds,
				supervisorId: user.id,
				crewAssignmentHistory: JSON.stringify([
					{
						userIds: assignedCrewIds,
						brigadeId,
						assignedById: user.id,
						assignedAt: new Date().toISOString(),
					},
				]),
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: doc.id,
				userId: user.id,
				action: "CREATED",
				diffJson: {
					status: { before: null, after: "CREATED" },
					brigadeId,
					serviceLines,
				},
			},
		})
		await tx.notification.createMany({
			data: warehouse.map((w) => ({
				userId: w.id,
				docId: doc.id,
				message: `New job ${controlNumber} — ${jobType} at ${jobAddressEstimated}. Please prepare materials.`,
			})),
		})
		return doc
	})

	throw redirect("/dashboard")
}

export default function NewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes, brigades } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_new.title")}</h1>
			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="jobAddressEstimated">
						{t("docs_new.job_address_label")}
					</Label>
					<Input
						id="jobAddressEstimated"
						name="jobAddressEstimated"
						placeholder="Calle X, Barrio Y, Municipio"
						required
					/>
				</div>
				<div>
					<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
					<Input
						id="jobType"
						name="jobType"
						placeholder="Mantenimiento, Instalación..."
						required
					/>
				</div>
				<div>
					<Label htmlFor="jobDescription">
						{t("docs_new.job_description_label")}
					</Label>
					<Textarea
						id="jobDescription"
						name="jobDescription"
						rows={2}
						required
					/>
				</div>
				<div>
					<Label>{t("docs_new.service_codes_label")}</Label>
					<ServicePicker />
				</div>
				<div>
					<Label>{t("docs_new.estimated_materials_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems serviceCodes={serviceCodes as any} />
					</div>
				</div>
				<div>
					<Label htmlFor="brigadeId">{t("docs_new.select_crew_label")}</Label>
					<select
						id="brigadeId"
						name="brigadeId"
						required
						defaultValue=""
						className="mt-1 w-full border rounded-md h-9 px-2 text-sm bg-white"
					>
						<option value="" disabled>
							{t("docs_new.select_crew_placeholder")}
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
				{(actionData as any)?.errorKey && (
					<p className="text-sm text-red-600">
						{t((actionData as any).errorKey)}
					</p>
				)}
				<Button type="submit" className="w-full">
					{t("docs_new.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

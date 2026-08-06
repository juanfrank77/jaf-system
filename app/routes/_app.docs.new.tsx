import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Document — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
		orderBy: { claroCode: "asc" },
	})
	const crew = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
	})
	return {
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		crew,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const form = await request.formData()

	const jobType = (form.get("jobType") as string).trim()
	const jobAddressEstimated = (form.get("jobAddressEstimated") as string).trim()
	const assignedCrewIds = form.getAll("assignedCrewIds") as string[]
	const materialsRaw = form.get("materials") as string
	const avisoNumber = (form.get("avisoNumber") as string | null)?.trim() || null

	let estimatedMaterials: { serviceCodeId: string; qty: number }[] = []
	try {
		estimatedMaterials = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { errorKey: "docs_new.errors.invalid_materials" }
	}

	if (!jobType || !jobAddressEstimated || assignedCrewIds.length === 0) {
		return {
			errorKey: "docs_new.errors.missing_fields",
		}
	}

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
				estimatedMaterials,
				assignedCrewIds,
				supervisorId: user.id,
				avisoNumber,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: doc.id,
				userId: user.id,
				action: "CREATED",
				diffJson: { status: { before: null, after: "CREATED" } },
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

	throw redirect(`/docs/${controlNumber}`)
}

export default function NewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes, crew } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_new.title")}</h1>
			<Form method="post" className="space-y-4">
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
					<Label htmlFor="avisoNumber">
						{t("docs_new.aviso_number_label")}
					</Label>
					<Input id="avisoNumber" name="avisoNumber" placeholder="10333185" />
				</div>
				<div>
					<Label>{t("docs_new.assigned_crew_label")}</Label>
					<div className="space-y-1 mt-1">
						{crew.map((c) => (
							<label key={c.id} className="flex items-center gap-2 text-sm">
								<input type="checkbox" name="assignedCrewIds" value={c.id} />
								{c.name}
							</label>
						))}
					</div>
				</div>
				<div>
					<Label>{t("docs_new.estimated_materials_label")}</Label>
					<div className="mt-1">
						<MaterialLineItems serviceCodes={serviceCodes as any} />
					</div>
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

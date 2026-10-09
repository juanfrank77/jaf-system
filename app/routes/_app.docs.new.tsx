import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { CrewPicker } from "~/components/crew-picker"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialPicker } from "~/components/material-picker"
import { ServicePicker } from "~/components/service-picker"
import { SupervisorStepRail } from "~/components/supervisor-step-rail"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { Textarea } from "~/components/ui/textarea"
import { generateControlNumber } from "~/lib/control-number.server"
import { buildCrewAssignment, parseBrigadeIds } from "~/lib/crew-assignment"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import {
	assignableBrigadesWhere,
	isBrigadeInSupervisorScope,
} from "~/lib/supervisor-scope"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Work Order — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const brigadeArgs = await assignableBrigadesWhere(db, user)
	const [materials, brigades] = await Promise.all([
		getActiveMaterialCodes(),
		db.brigade.findMany({
			where: brigadeArgs.where,
			orderBy: [{ area: "asc" }, { name: "asc" }],
			select: { id: true, name: true, area: true, code: true, leadName: true },
			take: brigadeArgs.take,
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
	const brigadeIds = parseBrigadeIds(form)
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

	if (!jobType || !jobAddressEstimated || brigadeIds.length === 0) {
		return { errorKey: "docs_new.errors.missing_fields" }
	}

	const brigades = await Promise.all(
		brigadeIds.map((id) => db.brigade.findUnique({ where: { id } })),
	)
	for (const brigade of brigades) {
		if (!brigade) return { errorKey: "docs_new.errors.brigade_invalid" }
		if (
			user.role === "SUPERVISOR" &&
			!(await isBrigadeInSupervisorScope(db, user.id, brigade))
		) {
			return { errorKey: "docs_new.errors.brigade_invalid" }
		}
	}
	const { brigadeId, assignedCrewIds } = buildCrewAssignment(
		brigades as NonNullable<(typeof brigades)[number]>[],
	)
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
				crewAssignmentHistory: [
					{
						userIds: assignedCrewIds,
						brigadeId,
						brigadeIds,
						assignedById: user.id,
						assignedAt: new Date().toISOString(),
					},
				],
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
					brigadeIds,
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
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("docs_new.title")} />
			<SupervisorStepRail stage="INTAKE" />
			<div className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
				<span className="font-semibold">{t("docs_new.callout_title")}</span>
				<span className="ml-2 text-muted-foreground">
					{t("docs_new.callout_body")}
				</span>
			</div>
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
									value={t("docs_new.work_order_auto")}
									readOnly
									disabled
									className="mt-1 font-mono"
								/>
								<Hint>{t("docs_new.work_order_hint")}</Hint>
							</div>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
								<Input
									id="jobType"
									name="jobType"
									placeholder="Mantenimiento, Instalación..."
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
									placeholder="Calle X, Barrio Y, Municipio"
									required
									className="mt-1"
								/>
								<Hint>{t("docs_new.job_address_hint")}</Hint>
							</div>
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
								className="mt-1"
							/>
						</div>
						<div>
							<Label>{t("docs_new.assigned_crew_label")}</Label>
							<div className="mt-1">
								<CrewPicker brigades={brigades} />
							</div>
							<Hint>{t("docs_new.crew_hint")}</Hint>
						</div>
						<div>
							<Label>{t("docs_new.service_codes_label")}</Label>
							<div className="mt-1">
								<ServicePicker />
							</div>
						</div>
						<div>
							<Label>{t("docs_new.estimated_materials_label")}</Label>
							<Hint>{t("docs_new.estimated_materials_hint")}</Hint>
							<div className="mt-1">
								<MaterialPicker materials={serviceCodes} />
							</div>
						</div>
						{error?.errorKey && (
							<p className="text-sm text-status-danger">{t(error.errorKey)}</p>
						)}
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<span>{t("docs_new.flow_prefix")}:</span>
							<span className="rounded-md bg-muted px-2.5 py-1">
								{t("docs_new.flow_warehouse")}
							</span>
							<span>+</span>
							<span className="rounded-md bg-muted px-2.5 py-1">
								{t("docs_new.flow_crew")}
							</span>
						</div>
						<Button type="submit">{t("docs_new.submit")}</Button>
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

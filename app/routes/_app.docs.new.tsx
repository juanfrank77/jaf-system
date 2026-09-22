import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServicePicker } from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import {
	activeBrigadesWhere,
	isBrigadeInScope,
} from "~/lib/brigade-scope.server"
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
			where: activeBrigadesWhere(user),
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
	if (!isBrigadeInScope(user, brigade)) {
		return { errorKey: "docs_new.errors.brigade_not_allowed" }
	}
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

function FormSection({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) {
	return (
		<div className="space-y-4 border-b border-border pb-6 last:border-b-0 last:pb-0">
			<h2 className="text-sm font-semibold text-foreground">{title}</h2>
			<div className="space-y-4">{children}</div>
		</div>
	)
}

export default function NewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes, brigades } = loaderData
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()

	function crewLabel(brigade: (typeof brigades)[number]) {
		return `${brigade.name}${brigade.code ? ` · ${brigade.code}` : ""}${
			brigade.area ? ` (${brigade.area})` : ""
		}`
	}

	return (
		<div className="mx-auto max-w-[880px]">
			<PageHeader
				title={t("docs_new.title")}
				subtitle={t("docs_new.subtitle")}
			/>
			<Form method="post" className="space-y-6">
				<FormSection title={t("docs_new.section_job_details")}>
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
				</FormSection>

				<FormSection title={t("docs_new.section_materials")}>
					<div>
						<Label>{t("docs_new.service_codes_label")}</Label>
						<ServicePicker />
					</div>
					<div>
						<Label>{t("docs_new.estimated_materials_label")}</Label>
						<div className="mt-1">
							<MaterialLineItems serviceCodes={serviceCodes} />
						</div>
					</div>
				</FormSection>

				<FormSection title={t("docs_new.section_assignment")}>
					<div>
						<Label htmlFor="brigadeId">{t("docs_new.select_crew_label")}</Label>
						<Select name="brigadeId" required>
							<SelectTrigger id="brigadeId" className="mt-1 w-full">
								<SelectValue
									placeholder={t("docs_new.select_crew_placeholder")}
								>
									{(value) => {
										const selected = brigades.find((b) => b.id === value)
										return selected
											? crewLabel(selected)
											: t("docs_new.select_crew_placeholder")
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{brigades.map((b) => (
									<SelectItem key={b.id} value={b.id}>
										{crewLabel(b)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</FormSection>

				{error?.errorKey && (
					<p className="rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
						{t(error.errorKey)}
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

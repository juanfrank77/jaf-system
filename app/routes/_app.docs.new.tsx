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
import { SupervisorStepRail } from "~/components/supervisor-step-rail"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
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
	canonicalizeAddress,
	loadAddressSuggestions,
} from "~/lib/address-suggestions.server"
import { generateControlNumber } from "~/lib/control-number.server"
import { buildCrewAssignment, parseBrigadeIds } from "~/lib/crew-assignment"
import { db } from "~/lib/db.server"
import { uploadFileName, validateBlueprintFile } from "~/lib/file-upload.server"
import { composeJobAddress, parseAddressInput } from "~/lib/intake-address"
import {
	type MaterialsChoice,
	type PrefieldChoice,
	parseIntakeAnswers,
	prefieldChoiceFor,
} from "~/lib/intake-answers"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	isPriceBlind,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { parseServiceLines, type ServiceLine } from "~/lib/service-lines"
import {
	assignableBrigadesWhere,
	isBrigadeInSupervisorScope,
} from "~/lib/supervisor-scope"
import { saveUpload } from "~/lib/uploads.server"
import type { Route } from "./+types/_app.docs.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New Work Order — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const brigadeArgs = await assignableBrigadesWhere(db, user)
	const [materials, brigades, claroSupervisors, suggestions] =
		await Promise.all([
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
				},
				take: brigadeArgs.take,
			}),
			db.claroSupervisor.findMany({
				where: { active: true },
				orderBy: { name: "asc" },
				select: {
					id: true,
					name: true,
					requiresPrefield: true,
					requiresBlueprint: true,
				},
			}),
			loadAddressSuggestions(),
		])
	return {
		user,
		serviceCodes: serviceCodesForRole(user.role, materials),
		showPrices: !isPriceBlind(user.role),
		brigades,
		claroSupervisors,
		suggestions,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const form = await request.formData()

	const jobType = ((form.get("jobType") as string) || "").trim()
	const claroSupervisorId = (
		(form.get("claroSupervisorId") as string) || ""
	).trim()
	const blueprints = form
		.getAll("blueprint")
		.filter((f): f is File => f instanceof File && f.size > 0)
	if (blueprints.some((f) => !validateBlueprintFile(f).valid))
		return { errorKey: "docs_new.errors.blueprint_invalid" }
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

	const claro = claroSupervisorId
		? await db.claroSupervisor.findUnique({ where: { id: claroSupervisorId } })
		: null
	if (!claro?.active) {
		return { errorKey: "docs_new.errors.claro_supervisor_required" }
	}
	// The supervisor's answers are stored and read from here on; the Claro
	// supervisor's requiresPrefield tag only pre-selected the choice.
	const answers = parseIntakeAnswers(form)
	if (!answers.ok) return { errorKey: answers.errorKey }
	const { materialsFromWarehouse, materialsReason, prefieldNeeded } =
		answers.value
	// No warehouse: nothing to prep or release, so the job goes straight to
	// Field (SIGNED) and carries no materials baseline.
	const status = materialsFromWarehouse ? "CREATED" : "SIGNED"
	if (!materialsFromWarehouse) estimatedMaterials = []

	const parsed = parseAddressInput(form)
	if (!parsed.ok) return { errorKey: parsed.errorKey }
	const address = await canonicalizeAddress(parsed.value)
	const jobAddressEstimated = composeJobAddress(address)

	if (!jobType || brigadeIds.length === 0) {
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
	const warehouse = materialsFromWarehouse
		? await db.user.findMany({ where: { role: "WAREHOUSE", active: true } })
		: []

	await db.$transaction(async (tx) => {
		const doc = await tx.jafInvoice.create({
			data: {
				controlNumber,
				status,
				jobType,
				jobAddressEstimated,
				claroSupervisorId: claro.id,
				sector: address.sector,
				direccion1: address.direccion1,
				direccion2: address.direccion2,
				latitud: address.latitud,
				longitud: address.longitud,
				tipo: address.tipo,
				ciudad: address.ciudad,
				tipoPlanta: address.tipoPlanta,
				grupoPlan: address.grupoPlan,
				materialsFromWarehouse,
				materialsReason,
				prefieldNeeded,
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
		if (blueprints.length > 0) {
			const blueprintPaths: string[] = []
			for (const [i, file] of blueprints.entries())
				blueprintPaths.push(
					await saveUpload(
						`blueprints/${doc.id}`,
						uploadFileName(file, i),
						file,
					),
				)
			await tx.jafInvoice.update({
				where: { id: doc.id },
				data: { blueprintPaths },
			})
		}
		await tx.auditTrail.create({
			data: {
				docId: doc.id,
				userId: user.id,
				action: "CREATED",
				diffJson: {
					status: { before: null, after: status },
					materialsFromWarehouse,
					materialsReason,
					prefieldNeeded,
					brigadeId,
					brigadeIds,
					serviceLines,
				},
			},
		})
		if (warehouse.length > 0)
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
	const { serviceCodes, brigades, showPrices, claroSupervisors, suggestions } =
		loaderData
	const [claroId, setClaroId] = useState("")
	const [materialsChoice, setMaterialsChoice] = useState<MaterialsChoice | "">(
		"",
	)
	const [prefieldChoice, setPrefieldChoice] = useState<PrefieldChoice | "">("")
	const claro = claroSupervisors.find((c) => c.id === claroId)
	const pickClaro = (id: string) => {
		setClaroId(id)
		// Pre-select Prefield from the Claro supervisor's tag; the supervisor
		// confirms or changes it.
		setPrefieldChoice(
			prefieldChoiceFor(claroSupervisors.find((c) => c.id === id)),
		)
	}
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("docs_new.title")} />
			<SupervisorStepRail
				stage="INTAKE"
				warehouseSkipped={materialsChoice === "no"}
			/>
			<div className="hidden rounded-xl border border-border bg-card px-3 py-2 text-sm md:block">
				<span className="font-semibold">{t("docs_new.callout_title")}</span>
				<span className="ml-2 text-muted-foreground">
					{t("docs_new.callout_body")}
				</span>
			</div>
			<details className="rounded-xl border border-border bg-card px-3 py-2 text-sm md:hidden">
				<summary className="cursor-pointer font-semibold">
					{t("docs_new.callout_title")} · {t("docs_new.callout_toggle")}
				</summary>
				<p className="mt-2 text-muted-foreground">
					{t("docs_new.callout_body")}
				</p>
			</details>
			<Form method="post" encType="multipart/form-data">
				<Card>
					<CardContent className="space-y-5">
						<div>
							<Label htmlFor="claroSupervisorId">
								{t("docs_new.claro_supervisor_label")}
							</Label>
							<Select
								name="claroSupervisorId"
								value={claroId}
								onValueChange={(v) => pickClaro(v ?? "")}
								items={claroSupervisors.map((c) => ({
									value: c.id,
									label: c.name,
								}))}
							>
								<SelectTrigger
									id="claroSupervisorId"
									autoFocus
									className="mt-1 h-11 w-full"
								>
									<SelectValue
										placeholder={t("docs_new.claro_supervisor_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{claroSupervisors.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{claro && (claro.requiresPrefield || claro.requiresBlueprint) && (
								<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
									<span className="text-muted-foreground">
										{t("docs_new.claro_requires")}
									</span>
									{claro.requiresPrefield && (
										<span className="rounded-md bg-muted px-2 py-0.5">
											{t("docs_new.requires_prefield_chip")}
										</span>
									)}
									{claro.requiresBlueprint && (
										<span className="rounded-md bg-muted px-2 py-0.5">
											{t("docs_new.requires_blueprint_chip")}
										</span>
									)}
								</div>
							)}
						</div>
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
							<div>
								<Label htmlFor="jobType">{t("docs_new.job_type_label")}</Label>
								<Input
									id="jobType"
									name="jobType"
									required
									placeholder="Mantenimiento, Instalación..."
									className="mt-1"
								/>
							</div>
						</div>
						<fieldset className="space-y-3">
							<legend className="text-sm font-semibold">
								{t("docs_new.address_heading")}
							</legend>
							<Hint>{t("docs_new.address_hint")}</Hint>
							<div className="grid gap-4 md:grid-cols-3">
								<TextField name="sector" label={t("docs_new.sector_label")} />
								<TextField
									name="direccion1"
									label={t("docs_new.direccion1_label")}
									required
								/>
								<TextField
									name="direccion2"
									label={t("docs_new.direccion2_label")}
								/>
								<TextField name="latitud" label={t("docs_new.latitud_label")} />
								<TextField
									name="longitud"
									label={t("docs_new.longitud_label")}
								/>
								<TextField
									name="tipo"
									label={t("docs_new.tipo_label")}
									required
									options={suggestions.tipo}
								/>
								<TextField name="ciudad" label={t("docs_new.ciudad_label")} />
								<TextField
									name="tipoPlanta"
									label={t("docs_new.tipo_planta_label")}
									required
									options={suggestions.tipoPlanta}
								/>
								<TextField
									name="grupoPlan"
									label={t("docs_new.grupo_plan_label")}
									required
									options={suggestions.grupoPlan}
								/>
							</div>
						</fieldset>
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
							<Label htmlFor="blueprint">{t("docs_new.blueprint_label")}</Label>
							<Input
								id="blueprint"
								name="blueprint"
								type="file"
								accept="image/jpeg,image/png,application/pdf"
								multiple
								className="mt-1"
							/>
							<Hint>{t("docs_new.blueprint_hint")}</Hint>
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
								<ServicePicker showPrices={showPrices} />
							</div>
						</div>
						<MaterialsSourceChoice
							value={materialsChoice}
							onChange={setMaterialsChoice}
						>
							<div>
								<Label>{t("docs_new.estimated_materials_label")}</Label>
								<Hint>{t("docs_new.estimated_materials_hint")}</Hint>
								<div className="mt-1">
									<MaterialPicker materials={serviceCodes} />
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
					</CardContent>
				</Card>
				<div className="sticky bottom-0 z-20 -mx-4 mt-4 space-y-1.5 border-t border-border bg-background/95 px-4 py-2 backdrop-blur md:-mx-8 md:space-y-2 md:px-8 md:py-3">
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:text-sm">
						<span>{t("docs_new.flow_prefix")}:</span>
						<span className="rounded-md bg-muted px-2 py-0.5 md:px-2.5 md:py-1">
							{materialsChoice === "no"
								? t("docs_new.flow_field")
								: t("docs_new.flow_warehouse")}
						</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<Link
							to="/dashboard"
							className={buttonVariants({ variant: "outline" })}
						>
							{t("docs_new.cancel")}
						</Link>
						<Button type="submit" className="h-10 px-5">
							{t("docs_new.submit")}
						</Button>
					</div>
				</div>
			</Form>
		</div>
	)
}

function TextField({
	name,
	label,
	required,
	options,
}: {
	name: string
	label: string
	required?: boolean
	options?: string[]
}) {
	const listId = options ? `${name}-options` : undefined
	return (
		<div>
			<Label htmlFor={name}>{label}</Label>
			<Input
				id={name}
				name={name}
				required={required}
				list={listId}
				className="mt-1"
			/>
			{options && (
				<datalist id={listId}>
					{options.map((o) => (
						<option key={o} value={o} />
					))}
				</datalist>
			)}
		</div>
	)
}

function Hint({ children }: { children: React.ReactNode }) {
	return <p className="mt-1 text-xs text-muted-foreground">{children}</p>
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

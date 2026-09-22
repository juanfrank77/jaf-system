import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import type { ComponentProps, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { StepRail } from "~/components/step-rail"
import { AvatarStack } from "~/components/ui/avatar-stack"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import {
	Card,
	CardContent,
	CardHeader,
	CardHeaderText,
	CardTitle,
} from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { BackLink, PageHeader } from "~/components/ui/page-header"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { db, Prisma } from "~/lib/db.server"
import {
	type AddressCorrection,
	formatTimeOnSite,
} from "~/lib/field-update-helpers"
import { requireJobAccess } from "~/lib/job-access.server"
import { isEditableStatus, isTerminalStatus } from "~/lib/permissions"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { deriveSupervisorStage } from "~/lib/supervisor-stage"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id"

type MaterialLine = { serviceCodeId: string; qty: number }

type CrewAssignmentEntry = {
	userIds: string[]
	assignedById: string
	assignedAt: string
}

type PreppedMaterialLine = {
	serviceCodeId: string
	preppedQty?: number
	estimatedQty?: number
	missing?: boolean
	substitutedWith?: string
	notes?: string
	_key?: string
}

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

export const meta: Route.MetaFunction = ({ data }) => [
	{ title: data ? `${data.doc.controlNumber} — JAF Ops` : "JAF Ops" },
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	requireJobAccess(user, doc, "read")
	const serviceCodes = await db.serviceCode.findMany()
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const assignedCrew = await db.user.findMany({
		where: { id: { in: doc.assignedCrewIds } },
	})
	// Load the actual signers (warehouse and crew who signed at pickup)
	const warehouseSigner = doc.releasedById
		? await db.user.findUnique({ where: { id: doc.releasedById } })
		: null
	const crewSigner = doc.signedById
		? await db.user.findUnique({ where: { id: doc.signedById } })
		: null
	const warehouse = doc.warehouseId
		? await db.warehouse.findUnique({ where: { id: doc.warehouseId } })
		: null
	if (
		doc.status === "LC_REQUEST_GENERATED" &&
		!["FINANCE", "ADMIN"].includes(user.role)
	) {
		throw new Response("Not Found", { status: 404 })
	}
	const auditTrail = await db.auditTrail.findMany({
		where: { docId: doc.id },
		include: { user: true },
		orderBy: { timestamp: "asc" },
	})
	const crewOptions = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		take: 100,
		select: { id: true, name: true },
	})
	const sheet = await db.preCertSheet.findFirst({
		where: { docId: doc.id, supersededAt: null },
		orderBy: { version: "desc" },
		select: { sigSupervisorAt: true, sigSubcontractorAt: true },
	})
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		supervisor,
		assignedCrew,
		warehouseSigner,
		crewSigner,
		warehouse,
		crewOptions: crewOptions.map((c) => ({ id: c.id, name: c.name })),
		auditTrail,
		stage: deriveSupervisorStage(doc, sheet),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	requireJobAccess(user, doc, "write")
	if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "cancel") {
		const reason = (form.get("reason") as string | null)?.trim() || ""
		if (!reason) return { errorKey: "docs_view.errors.cancel_reason_required" }
		if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
		await db.$transaction(async (tx) => {
			await tx.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "CANCELLED",
					cancellationReason: reason,
					cancelledAt: new Date(),
					cancelledById: user.id,
				},
			})
			await tx.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "DOC_CANCELLED",
					diffJson: {
						from: doc.status,
						to: "CANCELLED",
						reason,
					},
				},
			})
			// PRD §1.8 edge: job was already prepped → alert Warehouse to restock.
			if (doc.preppedAt) {
				const warehouseUsers = await tx.user.findMany({
					where: { role: "WAREHOUSE", active: true },
				})
				await Promise.all(
					warehouseUsers.map((w) =>
						tx.notification.create({
							data: {
								userId: w.id,
								docId: params.id,
								message: `Job ${doc.controlNumber} cancelled — please restock staged materials.`,
							},
						}),
					),
				)
			}
		})
		throw redirect(`/docs/${params.id}`)
	}

	if (intent === "reassign") {
		const newCrewId = (form.get("crewId") as string | null)?.trim() || ""
		if (!newCrewId) return { errorKey: "docs_view.errors.reassign_required" }
		const newCrew = await db.user.findUnique({
			where: { id: newCrewId },
		})
		if (newCrew?.role !== "CREW")
			return { errorKey: "docs_view.errors.reassign_invalid" }
		if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
		const history = (
			(doc.crewAssignmentHistory as unknown as CrewAssignmentEntry[]) || []
		).concat([
			{
				userIds: [newCrewId],
				assignedById: user.id,
				assignedAt: new Date().toISOString(),
			},
		])
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					assignedCrewIds: [newCrewId],
					crewAssignmentHistory: history,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "CREW_REASSIGNED",
					diffJson: {
						from: doc.assignedCrewIds,
						to: [newCrewId],
					},
				},
			}),
			db.notification.create({
				data: {
					userId: newCrewId,
					docId: params.id,
					message: `You have been reassigned to job ${doc.controlNumber}.`,
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	if (intent === "resolveMissing") {
		const note = (form.get("resolutionNote") as string | null)?.trim() || ""
		if (!note) return { errorKey: "docs_view.errors.resolution_note_required" }
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					prepChangedSincePrep: false,
					preppedMaterials:
						(doc.preppedMaterials as unknown as Prisma.InputJsonValue) ??
						Prisma.DbNull,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "MISSING_RESOLVED",
					diffJson: { note },
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	if (intent === "edit_aviso") {
		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || null
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { avisoNumber },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_NUMBER_SET",
					diffJson: { avisoNumber },
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	throw redirect(`/docs/${params.id}`)
}

function nextActionHref(
	doc: Route.ComponentProps["loaderData"]["doc"],
	userRole: string,
	userId: string,
): string | null {
	if (doc.status === "CREATED" && userRole === "WAREHOUSE")
		return `/docs/${doc.id}/prep`
	if (
		doc.status === "PREPPED" &&
		(userRole === "WAREHOUSE" ||
			userRole === "CREW" ||
			doc.assignedCrewIds?.includes(userId))
	)
		return `/docs/${doc.id}/sign`
	if (doc.status === "SIGNED" && doc.assignedCrewIds?.includes(userId))
		return `/docs/${doc.id}/field`
	if (
		doc.status === "FIELD_UPDATED" &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN")
	)
		return `/docs/${doc.id}/review`
	if (
		(doc.status === "SUPERVISOR_APPROVED" || doc.status === "CLARO_UPLOADED") &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN") &&
		!doc.releasedToFinanceAt
	)
		return `/docs/${doc.id}/review`
	if (
		(doc.status === "SUPERVISOR_APPROVED" || doc.status === "CLARO_UPLOADED") &&
		(userRole === "FINANCE" || userRole === "ADMIN")
	)
		return `/finance/verify/${doc.id}`
	return null
}

type NextActionLabelKey =
	| "docs_view.next_action.mark_prepped"
	| "docs_view.next_action.capture_signature"
	| "docs_view.next_action.update_from_field"
	| "docs_view.next_action.review_approve"
	| "docs_view.next_action.verify_for_finance"
	| "docs_view.next_action.generate_lc"
	| "docs_view.next_action.continue_review"
	| "docs_view.next_action.default"

function nextActionLabelKey(
	status: string,
	userRole: string,
): NextActionLabelKey {
	if (status === "CREATED") return "docs_view.next_action.mark_prepped"
	if (status === "PREPPED") return "docs_view.next_action.capture_signature"
	if (status === "SIGNED") return "docs_view.next_action.update_from_field"
	if (status === "FIELD_UPDATED") return "docs_view.next_action.review_approve"
	if (status === "SUPERVISOR_APPROVED" || status === "CLARO_UPLOADED") {
		if (userRole === "SUPERVISOR" || userRole === "ADMIN")
			return "docs_view.next_action.continue_review"
		if (status === "SUPERVISOR_APPROVED")
			return "docs_view.next_action.verify_for_finance"
		return "docs_view.next_action.generate_lc"
	}
	return "docs_view.next_action.default"
}

const STATUS_BADGE_VARIANT: Record<string, "ok" | "warn" | "danger" | "info"> =
	{
		CREATED: "warn",
		PREPPED: "info",
		SIGNED: "info",
		FIELD_UPDATED: "warn",
		SUPERVISOR_APPROVED: "info",
		CLARO_UPLOADED: "info",
		LC_REQUEST_GENERATED: "ok",
		CANCELLED: "danger",
	}

const STATUS_LABEL_KEY: Record<string, ParseKeys> = {
	CREATED: "docs_status.created",
	PREPPED: "docs_status.prepped",
	SIGNED: "docs_status.signed",
	FIELD_UPDATED: "docs_status.field_updated",
	SUPERVISOR_APPROVED: "docs_status.supervisor_approved",
	CLARO_UPLOADED: "docs_status.claro_uploaded",
	LC_REQUEST_GENERATED: "docs_status.lc_request_generated",
	CANCELLED: "docs_status.cancelled",
}

const APPROVED_STATUSES = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
] as const

export default function DocView({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		user,
		serviceCodes,
		supervisor,
		assignedCrew,
		warehouseSigner,
		crewSigner,
		warehouse,
		crewOptions,
		auditTrail,
		stage,
	} = loaderData
	const error = actionData as
		| { errorKey?: string; errorMessage?: string }
		| undefined
	const { t } = useTranslation()
	const nextHref = nextActionHref(doc, user.role, user.id)
	const estimated = (doc.estimatedMaterials as unknown as MaterialLine[]) || []
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const used = (doc.materialsUsed as unknown as MaterialLine[]) || []
	const corrections =
		(doc.addressCorrections as AddressCorrection[] | null) || []
	const gps = doc.gpsCoordinates as { lat: number; lng: number } | null
	const prepped =
		(doc.preppedMaterials as unknown as PreppedMaterialLine[]) || []
	const missingLines = prepped.filter((line) => line.missing)
	const materials = serviceCodes as unknown as MaterialServiceCode[]

	const isSupervisor = user.role === "SUPERVISOR" || user.role === "ADMIN"
	const canEdit = isSupervisor && isEditableStatus(doc.status)
	const canManage = isSupervisor && !isTerminalStatus(doc.status)
	const canReturns =
		(user.role === "WAREHOUSE" || user.role === "ADMIN") &&
		(doc.status === "SIGNED" || doc.status === "FIELD_UPDATED") &&
		!doc.materialsReturned
	const canAuditPackage =
		user.role === "SUPERVISOR" ||
		user.role === "FINANCE" ||
		user.role === "ADMIN"
	const canResolveMissing =
		isSupervisor && doc.status === "CREATED" && doc.prepChangedSincePrep
	const isApproved = APPROVED_STATUSES.includes(
		doc.status as (typeof APPROVED_STATUSES)[number],
	)
	const missingAviso = isApproved && !doc.avisoNumber
	const missingClaroPdf = isApproved && !doc.claroPdfPath
	const hasMaterials =
		estimated.length > 0 ||
		prepped.length > 0 ||
		taken.length > 0 ||
		used.length > 0
	const showSidebar = canManage

	return (
		<div>
			<PageHeader
				back={
					<BackLink to="/dashboard">
						{t("docs_view.back_to_dashboard")}
					</BackLink>
				}
				title={
					<span className="font-mono tracking-tight">{doc.controlNumber}</span>
				}
				subtitle={doc.jobType}
				meta={
					<Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? "neutral"} dot>
						{STATUS_LABEL_KEY[doc.status]
							? t(STATUS_LABEL_KEY[doc.status])
							: doc.status.replace(/_/g, " ")}
					</Badge>
				}
				actions={
					<>
						{canEdit && (
							<Link
								to={`/docs/${doc.id}/edit`}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{t("docs_view.edit_work_order")}
							</Link>
						)}
						{canReturns && (
							<Link
								to={`/docs/${doc.id}/returns`}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{t("docs_view.log_returns")}
							</Link>
						)}
						{user.role === "ADMIN" && (
							<Link
								to={`/admin/docs/${doc.id}`}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{t("docs_view.full_history")}
							</Link>
						)}
						{canAuditPackage && (
							<a
								href={`/docs/${doc.id}/audit-package`}
								className={buttonVariants({ variant: "outline", size: "sm" })}
								target="_blank"
								rel="noreferrer"
							>
								{t("docs_view.download_audit_package")}
							</a>
						)}
						{nextHref && (
							<Link to={nextHref} className={buttonVariants({ size: "sm" })}>
								{t(nextActionLabelKey(doc.status, user.role))}
							</Link>
						)}
					</>
				}
			/>

			<div className="space-y-6">
				{isSupervisor && <StepRail stage={stage} />}

				{error?.errorKey && (
					<p
						role="alert"
						className="rounded-lg border border-status-danger/20 bg-status-danger-soft px-4 py-3 text-sm text-status-danger"
					>
						{t(error.errorKey as ParseKeys)}
					</p>
				)}

				{doc.status === "CANCELLED" && (
					<div
						role="status"
						className="rounded-lg border border-status-danger/20 bg-status-danger-soft px-4 py-3"
					>
						<p className="text-sm font-semibold text-status-danger">
							{t("docs_view.cancelled_notice")}
						</p>
						{doc.cancellationReason && (
							<p className="mt-1 text-sm text-status-danger/80">
								{doc.cancellationReason}
							</p>
						)}
					</div>
				)}

				{(missingAviso || missingClaroPdf) && (
					<div
						role="status"
						className="flex items-start gap-3 rounded-lg border border-status-warn/20 bg-status-warn-soft px-4 py-3"
					>
						<HugeiconsIcon
							icon={Alert02Icon}
							strokeWidth={2}
							className="mt-0.5 size-5 shrink-0 text-status-warn"
						/>
						<div className="space-y-1">
							<p className="text-sm font-semibold text-status-warn">
								{t("docs_view.billing_blocked")}
							</p>
							<ul className="list-inside list-disc text-sm text-status-warn/90">
								{missingAviso && (
									<li>{t("docs_view.billing_blocked_aviso")}</li>
								)}
								{missingClaroPdf && (
									<li>{t("docs_view.billing_blocked_claro_pdf")}</li>
								)}
							</ul>
							<p className="text-xs text-status-warn/80">
								{t("docs_view.billing_blocked_hint")}
							</p>
						</div>
					</div>
				)}

				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
					<div className="space-y-6">
						<Card>
							<CardHeader divider>
								<CardHeaderText>
									<CardTitle>{t("docs_view.job_details")}</CardTitle>
								</CardHeaderText>
							</CardHeader>
							<CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
								<DetailField
									label={t("docs_view.address")}
									className="sm:col-span-2"
								>
									<p>
										{doc.jobAddressActual || doc.jobAddressEstimated}
										{gps && (
											<span className="ml-1 text-muted-foreground">
												({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
											</span>
										)}
									</p>
									{corrections.length > 0 && (
										<div className="mt-2 border-t border-border pt-2">
											<p className="mb-1 text-xs text-muted-foreground">
												{t("docs_view.address_corrections")}
											</p>
											<ul className="space-y-1">
												{corrections.map((correction) => (
													<li
														key={`${correction.original}-${correction.corrected}-${correction.correctedAt}`}
														className="text-xs"
													>
														<span className="text-muted-foreground line-through">
															{correction.original}
														</span>
														{" → "}
														<span className="font-medium">
															{correction.corrected}
														</span>
														{correction.gps && (
															<span className="ml-1 text-muted-foreground">
																({correction.gps.lat.toFixed(4)},{" "}
																{correction.gps.lng.toFixed(4)})
															</span>
														)}
													</li>
												))}
											</ul>
										</div>
									)}
								</DetailField>
								{doc.jobDescription && (
									<DetailField
										label={t("docs_view.job_description")}
										className="sm:col-span-2"
									>
										{doc.jobDescription}
									</DetailField>
								)}
								<DetailField label={t("docs_view.aviso_number")}>
									{canManage ? (
										<Form
											method="post"
											className="flex flex-wrap items-center gap-2"
										>
											<Label htmlFor="avisoNumber" className="sr-only">
												{t("docs_view.aviso_number")}
											</Label>
											<Input
												id="avisoNumber"
												type="text"
												name="avisoNumber"
												defaultValue={doc.avisoNumber || ""}
												placeholder="10333185"
												className="h-8 w-40"
											/>
											<input type="hidden" name="intent" value="edit_aviso" />
											<Button type="submit" size="sm" variant="outline">
												{t("docs_view.save_aviso")}
											</Button>
										</Form>
									) : (
										doc.avisoNumber || "—"
									)}
								</DetailField>
								<DetailField label={t("docs_view.created")}>
									{new Date(doc.createdAt).toLocaleString()}
								</DetailField>
								<DetailField label={t("docs_view.supervisor")}>
									{supervisor?.name || "—"}
								</DetailField>
								<DetailField label={t("docs_view.crew")}>
									{assignedCrew.length > 0 ? (
										<div className="flex items-center gap-2">
											<AvatarStack people={assignedCrew} />
											<span>
												{assignedCrew.map((crew) => crew.name).join(", ")}
											</span>
										</div>
									) : (
										"—"
									)}
								</DetailField>
								{warehouse && (
									<DetailField label={t("docs_view.warehouse")}>
										{warehouse.name} — {warehouse.zone}
									</DetailField>
								)}
								{warehouseSigner && (
									<DetailField label={t("docs_view.warehouse_signer")}>
										{warehouseSigner.name}
										{doc.releaseSignedAt && (
											<span className="text-xs text-muted-foreground ml-2">
												({new Date(doc.releaseSignedAt).toLocaleString()})
											</span>
										)}
									</DetailField>
								)}
								{crewSigner && (
									<DetailField label={t("docs_view.crew_signer")}>
										{crewSigner.name}
										{doc.signedAt && (
											<span className="text-xs text-muted-foreground ml-2">
												({new Date(doc.signedAt).toLocaleString()})
											</span>
										)}
									</DetailField>
								)}
								{doc.startedAt && doc.endedAt && (
									<DetailField label={t("docs_view.time_on_site")}>
										{formatTimeOnSite(doc.startedAt, doc.endedAt)}
									</DetailField>
								)}
								{doc.fieldNotes && (
									<DetailField
										label={t("docs_view.field_notes")}
										className="sm:col-span-2"
									>
										{doc.fieldNotes}
									</DetailField>
								)}
							</CardContent>
						</Card>

						{canResolveMissing && (
							<Card className="border-status-warn/30">
								<CardHeader divider>
									<CardHeaderText>
										<CardTitle className="text-status-warn">
											{t("docs_view.missing_materials_heading")}
										</CardTitle>
									</CardHeaderText>
								</CardHeader>
								<CardContent className="space-y-4">
									{missingLines.length > 0 && (
										<ul className="space-y-1.5">
											{missingLines.map((line) => {
												const code = serviceCodes.find(
													(item) => item.id === line.serviceCodeId,
												)
												return (
													<li
														key={`${line.serviceCodeId}-${line.substitutedWith ?? ""}-${line.notes ?? ""}`}
														className="text-sm text-foreground"
													>
														<span className="font-mono text-xs text-muted-foreground">
															{code?.claroCode}
														</span>{" "}
														{code?.name}:{" "}
														{line.substitutedWith
															? t("docs_view.substituted_label")
															: t("docs_view.missing_label")}
														{line.notes ? ` (${line.notes})` : ""}
													</li>
												)
											})}
										</ul>
									)}
									<Form method="post" className="space-y-3">
										<Label htmlFor="resolutionNote" className="sr-only">
											{t("docs_view.missing_materials_resolve")}
										</Label>
										<Textarea
											id="resolutionNote"
											name="resolutionNote"
											placeholder={t(
												"docs_view.missing_materials_resolution_placeholder",
											)}
											rows={2}
											required
										/>
										<input type="hidden" name="intent" value="resolveMissing" />
										<Button type="submit" variant="outline">
											{t("docs_view.missing_materials_resolve")}
										</Button>
									</Form>
								</CardContent>
							</Card>
						)}

						{hasMaterials && (
							<Card>
								<CardHeader divider>
									<CardHeaderText>
										<CardTitle>{t("docs_view.materials_heading")}</CardTitle>
									</CardHeaderText>
								</CardHeader>
								<CardContent className="space-y-6">
									{estimated.length > 0 && (
										<MaterialBlock title={t("docs_view.estimated_materials")}>
											<MaterialLineItems
												serviceCodes={materials}
												initialItems={estimated}
												readOnly
											/>
										</MaterialBlock>
									)}
									{prepped.length > 0 && (
										<MaterialBlock title={t("docs_view.prepped_materials")}>
											<MaterialLineItems
												serviceCodes={materials}
												initialItems={prepped.map((p) => ({
													serviceCodeId: p.serviceCodeId,
													qty: p.preppedQty ?? p.estimatedQty ?? 1,
												}))}
												readOnly
											/>
											{prepped.some((p) => p.missing) && (
												<div className="mt-2 text-xs text-status-warn">
													{missingLines.length}{" "}
													{t("docs_view.materials_missing")}
												</div>
											)}
										</MaterialBlock>
									)}
									{taken.length > 0 && (
										<MaterialBlock title={t("docs_view.materials_taken")}>
											<MaterialLineItems
												serviceCodes={materials}
												initialItems={taken}
												readOnly
											/>
											{doc.crewSignature && (
												<SignaturePreview
													src={doc.crewSignature}
													alt={t("docs_view.crew_signature_alt")}
												/>
											)}
										</MaterialBlock>
									)}
									{used.length > 0 && (
										<MaterialBlock title={t("docs_view.materials_used")}>
											<MaterialLineItems
												serviceCodes={materials}
												initialItems={used}
												readOnly
											/>
											{doc.completionSignature && (
												<SignaturePreview
													src={doc.completionSignature}
													alt={t("docs_view.completion_signature_alt")}
													caption={t("docs_view.completion_signature")}
												/>
											)}
										</MaterialBlock>
									)}
								</CardContent>
							</Card>
						)}

						{auditTrail.length > 0 && (
							<Card>
								<CardHeader divider>
									<CardHeaderText>
										<CardTitle>{t("docs_view.audit_trail")}</CardTitle>
									</CardHeaderText>
								</CardHeader>
								<CardContent>
									<ol className="relative space-y-4 border-l border-border pl-4">
										{auditTrail.map((entry) => (
											<li key={entry.id} className="relative">
												<span
													aria-hidden
													className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-muted-foreground/40"
												/>
												<p className="text-sm font-medium text-foreground">
													{entry.action.replace(/_/g, " ")}
												</p>
												<p className="text-xs text-muted-foreground">
													{entry.user.name}
													{" · "}
													{new Date(entry.timestamp).toLocaleString()}
												</p>
											</li>
										))}
									</ol>
								</CardContent>
							</Card>
						)}
					</div>

					{showSidebar && (
						<aside className="space-y-6 lg:sticky lg:top-6">
							<Card>
								<CardHeader divider>
									<CardHeaderText>
										<CardTitle>{t("docs_view.reassign_heading")}</CardTitle>
									</CardHeaderText>
								</CardHeader>
								<CardContent>
									<Form method="post" className="space-y-3">
										<Label htmlFor="crewId" className="sr-only">
											{t("docs_view.reassign_heading")}
										</Label>
										<Select name="crewId" required>
											<SelectTrigger id="crewId" className="w-full">
												<SelectValue
													placeholder={t("docs_view.reassign_placeholder")}
												/>
											</SelectTrigger>
											<SelectContent>
												{crewOptions.map(
													(crew: { id: string; name: string }) => (
														<SelectItem key={crew.id} value={crew.id}>
															{crew.name}
														</SelectItem>
													),
												)}
											</SelectContent>
										</Select>
										<input type="hidden" name="intent" value="reassign" />
										<Button type="submit" variant="outline" className="w-full">
											{t("docs_view.reassign_submit")}
										</Button>
									</Form>
								</CardContent>
							</Card>

							<Card className="border-status-danger/20">
								<CardHeader divider>
									<CardHeaderText>
										<CardTitle className="text-status-danger">
											{t("docs_view.cancel_heading")}
										</CardTitle>
									</CardHeaderText>
								</CardHeader>
								<CardContent>
									<Form method="post" className="space-y-3">
										<Label htmlFor="cancelReason" className="sr-only">
											{t("docs_view.cancel_heading")}
										</Label>
										<Textarea
											id="cancelReason"
											name="reason"
											placeholder={t("docs_view.cancel_placeholder")}
											rows={2}
											required
										/>
										<input type="hidden" name="intent" value="cancel" />
										<Button
											type="submit"
											variant="destructive"
											className="w-full"
										>
											{t("docs_view.cancel_submit")}
										</Button>
									</Form>
								</CardContent>
							</Card>
						</aside>
					)}
				</div>
			</div>
		</div>
	)
}

function DetailField({
	label,
	children,
	className,
}: {
	label: string
	children: ReactNode
	className?: string
}) {
	return (
		<div className={className}>
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<div className="mt-0.5 text-sm text-foreground">{children}</div>
		</div>
	)
}

function MaterialBlock({
	title,
	children,
}: {
	title: string
	children: ReactNode
}) {
	return (
		<section className="space-y-3 border-b border-border pb-6 last:border-b-0 last:pb-0">
			<h3 className="text-sm font-medium text-foreground">{title}</h3>
			{children}
		</section>
	)
}

function SignaturePreview({
	src,
	alt,
	caption,
}: {
	src: string
	alt: string
	caption?: string
}) {
	return (
		<div className="pt-1">
			{caption && (
				<p className="mb-1 text-xs text-muted-foreground">{caption}</p>
			)}
			<img
				src={src}
				alt={alt}
				className="max-h-16 rounded-md border border-border bg-background"
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

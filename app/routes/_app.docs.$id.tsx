import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { AssignedCrew } from "~/components/assigned-crew"
import { DocStageBadge } from "~/components/doc-stage-badge"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	asLines,
	JobLinesCard,
	preppedAsLines,
} from "~/components/job-lines-card"
import { MaterialLineItems } from "~/components/material-line-items"
import { ReassignForm } from "~/components/reassign-form"
import { SupervisorStepRail } from "~/components/supervisor-step-rail"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { hasAvisoPdf } from "~/lib/aviso-document"
import { canSeeBilling, hideBilling } from "~/lib/billing-visibility"
import {
	assignedBrigadeIds,
	buildCrewAssignment,
	readHistory,
} from "~/lib/crew-assignment"
import { isUnassignedCrew, notAssignedResponse } from "~/lib/crew-scope"
import { db } from "~/lib/db.server"
import {
	type AddressCorrection,
	formatTimeOnSite,
} from "~/lib/field-update-helpers"
import { validateFile } from "~/lib/file-upload.server"
import { isEditableStatus, isTerminalStatus } from "~/lib/permissions"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { serviceCodesForRole } from "~/lib/service-codes.server"
import {
	assertDocInSupervisorScope,
	assignableBrigadesWhere,
	isBrigadeInSupervisorScope,
} from "~/lib/supervisor-scope"
import { deriveSupervisorStage } from "~/lib/supervisor-stage"
import { saveUpload } from "~/lib/uploads.server"
import { Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id"

type MaterialLine = { serviceCodeId: string; qty: number }

type SendBackEntry = {
	createdAt: string
	byUserId: string
	fromStatus: string
	toStatus: string
	note: string
}

type CrewAssignmentEntry = {
	brigadeId: string
	brigadeIds?: string[]
	by: string
	at: string
}

export function reassignToBrigade(input: {
	doc: {
		id: string
		brigadeId: string | null
		assignedCrewIds: string[]
		crewAssignmentHistory: CrewAssignmentEntry[]
	}
	newBrigade: { id: string; memberIds: string[] }
	byUserId: string
}) {
	return {
		brigadeId: input.newBrigade.id,
		assignedCrewIds: input.newBrigade.memberIds,
		crewAssignmentHistory: [
			...input.doc.crewAssignmentHistory,
			{
				brigadeId: input.newBrigade.id,
				brigadeIds: [input.newBrigade.id],
				by: input.byUserId,
				at: new Date().toISOString(),
			},
		],
	}
}

type PreppedMaterialLine = {
	serviceCodeId: string
	missing?: boolean
	substitutedWith?: string
	notes?: string
	_key?: string
}

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

let _missingCounter = 0

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
		include: { brigade: { select: { area: true } } },
	})
	if (
		doc.status === "LC_REQUEST_GENERATED" &&
		!["FINANCE", "ADMIN"].includes(user.role)
	) {
		throw new Response("Not Found", { status: 404 })
	}
	if (isUnassignedCrew(user, doc)) throw notAssignedResponse()
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const serviceCodes = await db.serviceCode.findMany()
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const assignedCrew = await db.user.findMany({
		where: { id: { in: doc.assignedCrewIds } },
	})
	const auditTrail = await db.auditTrail.findMany({
		where: { docId: doc.id },
		include: { user: true },
		orderBy: { timestamp: "asc" },
	})
	const brigadeArgs = await assignableBrigadesWhere(db, user)
	const brigadeOptions = await db.brigade.findMany({
		where: brigadeArgs.where,
		orderBy: [{ area: "asc" }, { name: "asc" }],
		select: { id: true, name: true, area: true, code: true },
		take: brigadeArgs.take,
	})
	const sheet = await db.preCertSheet.findFirst({
		where: { docId: doc.id, supersededAt: null },
		orderBy: { version: "desc" },
		select: { sigSupervisorAt: true, sigSubcontractorAt: true },
	})
	const brigadeIds = assignedBrigadeIds(doc)
	const brigadeRows =
		brigadeIds.length > 0
			? await db.brigade.findMany({
					where: { id: { in: brigadeIds } },
					select: { id: true, name: true, code: true },
				})
			: []
	const assignedBrigades = brigadeIds.flatMap((id, i) => {
		const b = brigadeRows.find((r) => r.id === id)
		return b ? [{ id: b.id, name: b.name, code: b.code, lead: i === 0 }] : []
	})
	// Only a job that is still waiting on the fix (back at SIGNED) carries an
	// active send-back; once it is resubmitted the banner goes away.
	const sendBackHistory =
		(doc.sendBackHistory as unknown as SendBackEntry[] | null) ?? []
	const latest = sendBackHistory.at(-1) ?? null
	const latestSendBack = doc.status === "SIGNED" ? latest : null
	const sentBy = latestSendBack
		? await db.user.findUnique({ where: { id: latestSendBack.byUserId } })
		: null
	const correctorIds = [
		...new Set(
			((doc.addressCorrections as AddressCorrection[] | null) ?? []).map(
				(c) => c.correctedById,
			),
		),
	]
	const correctors =
		correctorIds.length > 0
			? await db.user.findMany({
					where: { id: { in: correctorIds } },
					select: { id: true, name: true },
				})
			: []
	return {
		doc: hideBilling(doc, user.role),
		user,
		correctorNames: Object.fromEntries(correctors.map((u) => [u.id, u.name])),
		latestSendBack,
		sentByName: sentBy?.name ?? null,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		supervisor,
		assignedCrew,
		assignedBrigades,
		brigadeOptions,
		// diffJson can carry aviso numbers and amounts.
		auditTrail: canSeeBilling(user.role)
			? auditTrail
			: auditTrail.map((a) => ({ ...a, diffJson: null })),
		stage: deriveSupervisorStage(doc, sheet),
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
		const newBrigadeId = (form.get("brigadeId") as string | null)?.trim() || ""
		if (!newBrigadeId) return { errorKey: "docs_view.errors.reassign_required" }
		const newBrigade = await db.brigade.findUnique({
			where: { id: newBrigadeId },
		})
		if (!newBrigade) return { errorKey: "docs_view.errors.reassign_invalid" }
		if (
			user.role === "SUPERVISOR" &&
			!(await isBrigadeInSupervisorScope(db, user.id, newBrigade))
		) {
			return { errorKey: "docs_view.errors.reassign_invalid" }
		}
		if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
		const { brigadeId, assignedCrewIds, crewAssignmentHistory } =
			reassignToBrigade({
				doc: {
					id: doc.id,
					brigadeId: doc.brigadeId,
					assignedCrewIds: doc.assignedCrewIds,
					crewAssignmentHistory: readHistory(
						doc.crewAssignmentHistory,
					) as unknown as CrewAssignmentEntry[],
				},
				newBrigade: { id: newBrigade.id, memberIds: newBrigade.memberIds },
				byUserId: user.id,
			})
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					brigadeId,
					assignedCrewIds,
					crewAssignmentHistory,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "CREW_REASSIGNED",
					diffJson: {
						from: {
							brigadeId: doc.brigadeId,
							assignedCrewIds: doc.assignedCrewIds,
						},
						to: { brigadeId, assignedCrewIds },
					},
				},
			}),
			db.notification.createMany({
				data: assignedCrewIds.map((memberId) => ({
					userId: memberId,
					docId: params.id,
					message: `You have been reassigned to job ${doc.controlNumber}.`,
				})),
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	if (intent === "change_lead") {
		const newLeadId = (form.get("brigadeId") as string | null)?.trim() || ""
		if (!newLeadId) return { errorKey: "docs_view.errors.reassign_required" }
		const current = assignedBrigadeIds(doc)
		// Only a brigade already on the job can take over as lead; this keeps
		// every crew and moves only the payee.
		if (!current.includes(newLeadId))
			return { errorKey: "docs_view.errors.reassign_invalid" }
		if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
		// The payee is copied into contractorAccountCode at the pre-cert
		// signature; moving the lead afterwards would not move the payment.
		if (doc.contractorAccountCode)
			return { errorKey: "docs_view.errors.lead_locked" }
		const brigadeIds = [newLeadId, ...current.filter((id) => id !== newLeadId)]
		const rows = await db.brigade.findMany({
			where: { id: { in: brigadeIds } },
		})
		const ordered = brigadeIds.flatMap(
			(id) => rows.find((r) => r.id === id) ?? [],
		)
		if (ordered.length !== brigadeIds.length)
			return { errorKey: "docs_view.errors.reassign_invalid" }
		// The doc-level scope guard only covers the current lead; an Admin may
		// have put out-of-area brigades on the job, so the incoming payee must
		// be in scope too.
		if (
			user.role === "SUPERVISOR" &&
			!(await isBrigadeInSupervisorScope(db, user.id, ordered[0]))
		)
			return { errorKey: "docs_view.errors.reassign_invalid" }
		const { brigadeId, assignedCrewIds } = buildCrewAssignment(ordered)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					brigadeId,
					assignedCrewIds,
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
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "CREW_LEAD_CHANGED",
					diffJson: {
						from: { brigadeId: doc.brigadeId, brigadeIds: current },
						to: { brigadeId, brigadeIds },
					},
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

	if (intent === "attach_aviso_pdf") {
		// Only a job already with Finance that has no Aviso PDF on file: the
		// step-6 upload stays the one way to set it before release.
		if (!doc.releasedToFinanceAt || hasAvisoPdf(doc))
			throw redirect(`/docs/${params.id}`)
		const avisoPdf = form.get("avisoPdf")
		if (!(avisoPdf instanceof File) || avisoPdf.size === 0)
			return { errorKey: "docs_review.errors.aviso_pdf_required" as const }
		const validation = validateFile(avisoPdf, "pdf")
		if (!validation.valid) return { errorMessage: validation.error }
		const avisoDocPath = await saveUpload(
			"aviso-docs",
			`${params.id}-aviso.pdf`,
			avisoPdf,
		)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { avisoDocPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_PDF_ATTACHED",
					diffJson: { avisoDocPath },
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
		assignedBrigades,
		brigadeOptions,
		auditTrail,
		stage,
		latestSendBack,
		sentByName,
		correctorNames,
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
	const correctorName = (id: string): string | undefined =>
		correctorNames[id] ?? (id === user.id ? user.name : undefined)

	const APPROVED_STATUSES = [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_REQUEST_GENERATED",
	] as const
	const isApproved = APPROVED_STATUSES.includes(
		doc.status as (typeof APPROVED_STATUSES)[number],
	)
	const showBilling = canSeeBilling(user.role)
	// Billing needs the Aviso PDF once the job is with Finance; the same rule the
	// release gate and Finance receivables use.
	const missingAvisoPdf =
		showBilling && isApproved && !!doc.releasedToFinanceAt && !hasAvisoPdf(doc)
	const canAttachAviso = user.role === "SUPERVISOR" || user.role === "ADMIN"

	return (
		<div className="space-y-5">
			{(user.role === "SUPERVISOR" || user.role === "ADMIN") && (
				<SupervisorStepRail stage={stage} docId={doc.id} page="job" />
			)}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
					<p className="text-sm text-muted-foreground">{doc.jobType}</p>
				</div>
				<DocStageBadge stage={stage} cancelled={doc.status === "CANCELLED"} />
			</div>

			{latestSendBack && (
				<Callout
					tone="danger"
					title={t("docs_field.sent_back_by", {
						name: sentByName ?? t("docs_field.sent_back_by_unknown"),
					})}
				>
					{latestSendBack.note}{" "}
					<span className="text-xs opacity-80">
						{new Date(latestSendBack.createdAt).toLocaleString()}
					</span>
				</Callout>
			)}

			{user.role === "CREW" &&
				doc.status === "FIELD_UPDATED" &&
				doc.fieldSubmittedAt && (
					<Callout
						tone="ok"
						icon="✓"
						title={t("docs_view.submitted_title", {
							control: doc.controlNumber,
							time: new Date(doc.fieldSubmittedAt).toLocaleString([], {
								dateStyle: "short",
								timeStyle: "short",
							}),
						})}
					>
						{t("docs_view.submitted_body", {
							name: supervisor?.name ?? t("docs_field.sent_back_by_unknown"),
						})}
					</Callout>
				)}

			{missingAvisoPdf && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-4 space-y-2">
					<div className="flex items-start gap-3">
						<span className="text-status-warn text-lg" aria-hidden>
							⚠
						</span>
						<div className="space-y-1">
							<p className="font-medium text-status-warn">
								{t("docs_view.billing_blocked")}
							</p>
							<ul className="text-sm text-status-warn list-disc list-inside">
								<li>{t("docs_view.billing_blocked_aviso_pdf")}</li>
							</ul>
							{canAttachAviso ? (
								<Form
									method="post"
									encType="multipart/form-data"
									className="flex flex-wrap items-center gap-2 pt-1"
								>
									<input type="hidden" name="intent" value="attach_aviso_pdf" />
									<Input
										type="file"
										name="avisoPdf"
										accept="application/pdf"
										required
										aria-label={t("docs_view.attach_aviso_label")}
										className="w-auto"
									/>
									<Button type="submit" size="sm">
										{t("docs_view.attach_aviso_submit")}
									</Button>
								</Form>
							) : (
								<p className="text-sm text-status-warn">
									{t("docs_view.billing_blocked_ask_supervisor")}
								</p>
							)}
							{actionData && "errorMessage" in actionData && (
								<p className="text-sm text-status-danger">
									{actionData.errorMessage}
								</p>
							)}
							{actionData &&
								"errorKey" in actionData &&
								actionData.errorKey ===
									"docs_review.errors.aviso_pdf_required" && (
									<p className="text-sm text-status-danger">
										{t(actionData.errorKey)}
									</p>
								)}
						</div>
					</div>
				</div>
			)}

			<section className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-muted-foreground">
						{t("docs_view.address")}:
					</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
					{gps && (
						<span className="ml-1 text-muted-foreground">
							({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
						</span>
					)}
				</p>
				{corrections.length > 0 && (
					<div className="pt-2 border-t">
						<p className="text-muted-foreground text-xs mb-1">
							{t("docs_view.address_corrections")}
						</p>
						<ul className="space-y-1">
							{corrections.map((c) => (
								<li
									key={`${c.original}-${c.corrected}-${c.correctedAt}`}
									className="text-xs"
								>
									<span className="line-through text-muted-foreground">
										{c.original}
									</span>
									{" → "}
									<span className="font-medium">{c.corrected}</span>
									{c.gps && (
										<span className="ml-1 text-muted-foreground">
											({c.gps.lat.toFixed(4)}, {c.gps.lng.toFixed(4)})
										</span>
									)}
									<span className="block text-muted-foreground">
										{t("docs_view.address_edited_by", {
											name:
												correctorName(c.correctedById) ??
												t("docs_view.address_edited_by_unknown"),
											when: new Date(c.correctedAt).toLocaleString([], {
												dateStyle: "short",
												timeStyle: "short",
											}),
										})}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
				{showBilling && (
					<p>
						<span className="text-muted-foreground">
							{t("docs_view.aviso_number")}:
						</span>{" "}
						{doc.avisoNumber ?? (
							<span className="text-muted-foreground">
								{t("docs_view.aviso_pending")}
							</span>
						)}
					</p>
				)}
				<p>
					<span className="text-muted-foreground">
						{t("docs_view.supervisor")}:
					</span>{" "}
					{supervisor?.name}
				</p>
				<AssignedCrew
					brigades={assignedBrigades}
					memberNames={assignedCrew.map((c) => c.name)}
				/>
				<p>
					<span className="text-muted-foreground">
						{t("docs_view.created")}:
					</span>{" "}
					{new Date(doc.createdAt).toLocaleString()}
				</p>
			</section>

			<JobLinesCard
				ordered={asLines(doc.serviceLines)}
				installed={asLines(doc.installedServiceLines)}
				estimated={estimated}
				prepped={preppedAsLines(doc.preppedMaterials)}
				taken={taken}
				used={used}
				serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
				showMaterials={false}
			/>

			{estimated.length > 0 && (
				<section className="bg-card border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-muted-foreground">
						{t("docs_view.estimated_materials")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={estimated}
						readOnly
					/>
				</section>
			)}

			{taken.length > 0 && (
				<section className="bg-card border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-muted-foreground">
						{t("docs_view.materials_taken")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={taken}
						readOnly
					/>
					{doc.crewSignature && (
						<img
							src={doc.crewSignature}
							alt={t("docs_view.crew_signature_alt")}
							className="mt-3 border rounded max-h-16"
						/>
					)}
				</section>
			)}

			{used.length > 0 && (
				<section className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium mb-2 text-muted-foreground">
						{t("docs_view.materials_used")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={used}
						readOnly
					/>
					{doc.startedAt && doc.endedAt && (
						<p className="text-sm text-muted-foreground">
							<span className="text-muted-foreground">
								{t("docs_view.time_on_site")}:
							</span>{" "}
							{formatTimeOnSite(doc.startedAt, doc.endedAt)}
						</p>
					)}
					{doc.fieldNotes && (
						<p className="text-sm text-muted-foreground">{doc.fieldNotes}</p>
					)}
					{doc.completionSignature && (
						<div>
							<p className="text-xs text-muted-foreground mb-1">
								{t("docs_view.completion_signature")}
							</p>
							<img
								src={doc.completionSignature}
								alt={t("docs_view.completion_signature_alt")}
								className="border rounded max-h-16"
							/>
						</div>
					)}
				</section>
			)}

			{nextHref && (
				<Link to={nextHref} className={buttonVariants({ className: "w-full" })}>
					{t(nextActionLabelKey(doc.status, user.role))}
				</Link>
			)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				isEditableStatus(doc.status) && (
					<Link
						to={`/docs/${doc.id}/edit`}
						className={buttonVariants({
							variant: "outline",
							className: "w-full",
						})}
					>
						{t("docs_view.edit_work_order")}
					</Link>
				)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				doc.status === "CREATED" &&
				doc.prepChangedSincePrep && (
					<div className="space-y-2 pt-2 border-t">
						<p className="text-sm font-medium text-status-warn">
							{t("docs_view.missing_materials_heading")}
						</p>
						{(() => {
							const prepped =
								(doc.preppedMaterials as unknown as PreppedMaterialLine[]) || []
							const missingLines = prepped
								.filter((l) => l.missing)
								.map((line) => ({
									...line,
									_key: `missing-${(_missingCounter++).toString()}`,
								}))
							if (missingLines.length === 0) return null
							return (
								<div className="space-y-1">
									{missingLines.map((line) => {
										const code = serviceCodes.find(
											(c) => c.id === line.serviceCodeId,
										)
										return (
											<p
												key={line._key}
												className="text-xs text-muted-foreground"
											>
												{code?.claroCode} — {code?.name}:{" "}
												{line.substitutedWith ? `substituted` : `missing`}
												{line.notes ? ` (${line.notes})` : ""}
											</p>
										)
									})}
								</div>
							)
						})()}
						<Form method="post" className="space-y-2">
							<Textarea
								name="resolutionNote"
								placeholder={t(
									"docs_view.missing_materials_resolution_placeholder",
								)}
								rows={2}
								required
							/>
							<input type="hidden" name="intent" value="resolveMissing" />
							<Button type="submit" variant="outline" className="w-full">
								{t("docs_view.missing_materials_resolve")}
							</Button>
						</Form>
						{error?.errorKey && (
							<p className="text-sm text-status-danger">
								{t(error.errorKey as ParseKeys)}
							</p>
						)}
					</div>
				)}

			{(user.role === "WAREHOUSE" || user.role === "ADMIN") &&
				(doc.status === "SIGNED" || doc.status === "FIELD_UPDATED") &&
				!doc.materialsReturned && (
					<Link
						to={`/docs/${doc.id}/returns`}
						className={buttonVariants({
							variant: "outline",
							className: "w-full",
						})}
					>
						{t("docs_view.log_returns")}
					</Link>
				)}

			{user.role === "ADMIN" && (
				<Link
					to={`/admin/docs/${doc.id}`}
					className={buttonVariants({
						variant: "outline",
						className: "w-full mt-2",
					})}
				>
					{t("docs_view.full_history")}
				</Link>
			)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				!isTerminalStatus(doc.status) && (
					<div className="space-y-3 pt-2 border-t">
						<ReassignForm
							leadLocked={!!doc.contractorAccountCode}
							brigadeOptions={brigadeOptions}
							assignedBrigades={assignedBrigades}
						/>

						<Form method="post" className="space-y-2">
							<Label htmlFor="cancelReason">
								{t("docs_view.cancel_heading")}
							</Label>
							<Input
								id="cancelReason"
								name="reason"
								placeholder={t("docs_view.cancel_placeholder")}
								required
								className="h-11 px-4"
							/>
							<input type="hidden" name="intent" value="cancel" />
							<Button type="submit" variant="destructive" className="h-10 px-5">
								{t("docs_view.cancel_submit")}
							</Button>
							{error?.errorKey && (
								<p className="text-sm text-status-danger">
									{t(error.errorKey as ParseKeys)}
								</p>
							)}
						</Form>
					</div>
				)}

			{auditTrail.length > 0 && (
				<section className="space-y-2 pt-3 border-t">
					<p className="text-sm font-semibold text-foreground">
						{t("docs_view.audit_trail")}
					</p>
					{auditTrail.map((a) => (
						<p className="text-sm text-muted-foreground" key={a.id}>
							{new Date(a.timestamp).toLocaleString()} — {a.user.name}:{" "}
							{a.action}
						</p>
					))}
				</section>
			)}

			{(user.role === "SUPERVISOR" ||
				user.role === "FINANCE" ||
				user.role === "ADMIN") && (
				<a
					href={`/docs/${doc.id}/audit-package`}
					className={buttonVariants({
						variant: "outline",
						className: "bg-primary text-primary-foreground",
					})}
					target="_blank"
					rel="noreferrer"
				>
					{t("docs_view.download_audit_package")}
				</a>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

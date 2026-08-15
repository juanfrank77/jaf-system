import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button, buttonVariants } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import {
	type AddressCorrection,
	formatTimeOnSite,
} from "~/lib/field-update-helpers"
import { isEditableStatus, isTerminalStatus } from "~/lib/permissions"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id"

let _missingCounter = 0
const nextMissingKey = () => `missing-${(_missingCounter++).toString()}`

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
	const crewOptions = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
		take: 100,
		select: { id: true, name: true },
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
		crewOptions: crewOptions.map((c) => ({ id: c.id, name: c.name })),
		auditTrail,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
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
		if (!newCrew || newCrew.role !== "CREW")
			return { errorKey: "docs_view.errors.reassign_invalid" }
		if (isTerminalStatus(doc.status)) throw redirect(`/docs/${params.id}`)
		const history = ((doc.crewAssignmentHistory as any[]) || []).concat([
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
		] as any)
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
					preppedMaterials: (doc.preppedMaterials as any) || null,
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
		] as any)
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
		] as any)
		throw redirect(`/docs/${params.id}`)
	}

	throw redirect(`/docs/${params.id}`)
}

function nextActionHref(
	doc: any,
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
	| "docs_view.next_action.default"

function nextActionLabelKey(status: string): NextActionLabelKey {
	if (status === "CREATED") return "docs_view.next_action.mark_prepped"
	if (status === "PREPPED") return "docs_view.next_action.capture_signature"
	if (status === "SIGNED") return "docs_view.next_action.update_from_field"
	if (status === "FIELD_UPDATED") return "docs_view.next_action.review_approve"
	if (status === "SUPERVISOR_APPROVED")
		return "docs_view.next_action.verify_for_finance"
	if (status === "CLARO_UPLOADED") return "docs_view.next_action.generate_lc"
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
		crewOptions,
		auditTrail,
	} = loaderData
	const error = actionData as
		| { errorKey?: any; errorMessage?: string }
		| undefined
	const { t } = useTranslation()
	const nextHref = nextActionHref(doc, user.role, user.id)
	const estimated = (doc.estimatedMaterials as any[]) || []
	const taken = (doc.materialsTaken as any[]) || []
	const used = (doc.materialsUsed as any[]) || []
	const corrections =
		(doc.addressCorrections as AddressCorrection[] | null) || []
	const gps = doc.gpsCoordinates as { lat: number; lng: number } | null

	const APPROVED_STATUSES = [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_GENERATED",
	] as const
	const isApproved = APPROVED_STATUSES.includes(
		doc.status as (typeof APPROVED_STATUSES)[number],
	)
	const missingAviso = isApproved && !doc.avisoNumber
	const missingClaroPdf = isApproved && !doc.claroPdfPath

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
					<p className="text-sm text-slate-500">{doc.jobType}</p>
				</div>
				<span className="text-xs bg-slate-100 px-3 py-1 rounded-full font-medium">
					{doc.status.replace(/_/g, " ")}
				</span>
			</div>

			{(missingAviso || missingClaroPdf) && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
					<div className="flex items-start gap-3">
						<span className="text-amber-600 text-lg" aria-hidden>
							⚠
						</span>
						<div className="space-y-1">
							<p className="font-medium text-amber-900">
								{t("docs_view.billing_blocked")}
							</p>
							<ul className="text-sm text-amber-800 list-disc list-inside">
								{missingAviso && (
									<li>{t("docs_view.billing_blocked_aviso")}</li>
								)}
								{missingClaroPdf && (
									<li>{t("docs_view.billing_blocked_claro_pdf")}</li>
								)}
							</ul>
							<p className="text-xs text-amber-700">
								{t("docs_view.billing_blocked_hint")}
							</p>
						</div>
					</div>
				</div>
			)}

			<section className="bg-white border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-slate-500">{t("docs_view.address")}:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
					{gps && (
						<span className="ml-1 text-slate-400">
							({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
						</span>
					)}
				</p>
				{corrections.length > 0 && (
					<div className="pt-2 border-t">
						<p className="text-slate-500 text-xs mb-1">
							{t("docs_view.address_corrections")}
						</p>
						<ul className="space-y-1">
							{corrections.map((c) => (
								<li
									key={`${c.original}-${c.corrected}-${c.correctedAt}`}
									className="text-xs"
								>
									<span className="line-through text-slate-400">
										{c.original}
									</span>
									{" → "}
									<span className="font-medium">{c.corrected}</span>
									{c.gps && (
										<span className="ml-1 text-slate-400">
											({c.gps.lat.toFixed(4)}, {c.gps.lng.toFixed(4)})
										</span>
									)}
								</li>
							))}
						</ul>
					</div>
				)}
				{doc.avisoNumber && (
					<p>
						<span className="text-slate-500">
							{t("docs_view.aviso_number")}:
						</span>{" "}
						{doc.avisoNumber}
					</p>
				)}
				{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
					doc.status !== "CANCELLED" &&
					doc.status !== "LC_GENERATED" && (
						<Form method="post" className="flex items-center gap-2">
							<Input
								type="text"
								name="avisoNumber"
								defaultValue={doc.avisoNumber || ""}
								placeholder="10333185"
								className="h-8 w-40"
							/>
							<input type="hidden" name="intent" value="edit_aviso" />
							<Button type="submit" size="sm" variant="outline">
								Save Aviso #
							</Button>
						</Form>
					)}
				<p>
					<span className="text-slate-500">{t("docs_view.supervisor")}:</span>{" "}
					{supervisor?.name}
				</p>
				<p>
					<span className="text-slate-500">{t("docs_view.crew")}:</span>{" "}
					{assignedCrew.map((c) => c.name).join(", ")}
				</p>
				<p>
					<span className="text-slate-500">{t("docs_view.created")}:</span>{" "}
					{new Date(doc.createdAt).toLocaleString()}
				</p>
			</section>

			{estimated.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.estimated_materials")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={estimated}
						readOnly
					/>
				</section>
			)}

			{taken.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.materials_taken")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
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
				<section className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.materials_used")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={used}
						readOnly
					/>
					{doc.startedAt && doc.endedAt && (
						<p className="text-sm text-slate-600">
							<span className="text-slate-500">
								{t("docs_view.time_on_site")}:
							</span>{" "}
							{formatTimeOnSite(doc.startedAt, doc.endedAt)}
						</p>
					)}
					{doc.fieldNotes && (
						<p className="text-sm text-slate-600">{doc.fieldNotes}</p>
					)}
					{doc.completionSignature && (
						<div>
							<p className="text-xs text-slate-500 mb-1">
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
					{t(nextActionLabelKey(doc.status))}
				</Link>
			)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				isEditableStatus(doc.status) && (
					<Link
						to={`/docs/${(doc as any).id}/edit`}
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
				(doc as any).prepChangedSincePrep && (
					<div className="space-y-2 pt-2 border-t">
						<p className="text-sm font-medium text-amber-700">
							{t("docs_view.missing_materials_heading")}
						</p>
						{(() => {
							const prepped = (doc.preppedMaterials as any[]) || []
							const missingLines = prepped
								.filter((l: any) => l.missing)
								.map((line: any) => ({
									...line,
									_key: `missing-${(_missingCounter++).toString()}`,
								}))
							if (missingLines.length === 0) return null
							return (
								<div className="space-y-1">
									{missingLines.map((line: any) => {
										const code = serviceCodes.find(
											(c: any) => c.id === line.serviceCodeId,
										)
										return (
											<p key={line._key} className="text-xs text-slate-600">
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
							<p className="text-sm text-red-600">{t(error.errorKey)}</p>
						)}
					</div>
				)}

			{(user.role === "WAREHOUSE" || user.role === "ADMIN") &&
				(doc.status === "SIGNED" || doc.status === "FIELD_UPDATED") &&
				!(doc as any).materialsReturned && (
					<Link
						to={`/docs/${(doc as any).id}/returns`}
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
					to={`/admin/docs/${(doc as any).id}`}
					className={buttonVariants({
						variant: "outline",
						className: "w-full mt-2",
					})}
				>
					{t("docs_view.full_history")}
				</Link>
			)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				doc.status !== "CANCELLED" &&
				doc.status !== "LC_GENERATED" && (
					<div className="space-y-3 pt-2 border-t">
						<Form method="post" className="space-y-2">
							<fieldset className="border rounded-lg p-3 space-y-2">
								<legend className="text-sm font-medium px-1">
									{t("docs_view.reassign_heading")}
								</legend>
								<Select name="crewId" required>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t("docs_view.reassign_placeholder")}
										/>
									</SelectTrigger>
									<SelectContent>
										{crewOptions.map((c: { id: string; name: string }) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<input type="hidden" name="intent" value="reassign" />
								<Button type="submit" variant="outline" size="sm">
									{t("docs_view.reassign_submit")}
								</Button>
							</fieldset>
						</Form>

						<Form method="post" className="space-y-2">
							<fieldset className="border rounded-lg p-3 space-y-2">
								<legend className="text-sm font-medium px-1 text-red-700">
									{t("docs_view.cancel_heading")}
								</legend>
								<Textarea
									name="reason"
									placeholder={t("docs_view.cancel_placeholder")}
									rows={2}
									required
								/>
								<input type="hidden" name="intent" value="cancel" />
								<Button type="submit" variant="destructive" size="sm">
									{t("docs_view.cancel_submit")}
								</Button>
							</fieldset>
							{error?.errorKey && (
								<p className="text-sm text-red-600">{t(error.errorKey)}</p>
							)}
						</Form>
					</div>
				)}

			{(user.role === "SUPERVISOR" ||
				user.role === "FINANCE" ||
				user.role === "ADMIN") && (
				<a
					href={`/docs/${(doc as any).id}/audit-package`}
					className={buttonVariants({
						variant: "outline",
						className: "mt-2 bg-primary text-primary-foreground",
					})}
					target="_blank"
					rel="noreferrer"
				>
					{t("docs_view.download_audit_package")}
				</a>
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
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

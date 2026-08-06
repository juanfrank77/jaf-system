import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button, buttonVariants } from "~/components/ui/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id"

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
		if (doc.status === "CANCELLED" || doc.status === "LC_GENERATED")
			throw redirect(`/docs/${params.id}`)
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
		if (doc.status === "CANCELLED" || doc.status === "LC_GENERATED")
			throw redirect(`/docs/${params.id}`)
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
	if (doc.status === "CLARO_UPLOADED" && userRole === "FINANCE")
		return `/docs/${doc.id}/lc`
	return null
}

type NextActionLabelKey =
	| "docs_view.next_action.mark_prepped"
	| "docs_view.next_action.capture_signature"
	| "docs_view.next_action.update_from_field"
	| "docs_view.next_action.review_approve"
	| "docs_view.next_action.generate_lc"
	| "docs_view.next_action.default"

function nextActionLabelKey(status: string): NextActionLabelKey {
	if (status === "CREATED") return "docs_view.next_action.mark_prepped"
	if (status === "PREPPED") return "docs_view.next_action.capture_signature"
	if (status === "SIGNED") return "docs_view.next_action.update_from_field"
	if (status === "FIELD_UPDATED") return "docs_view.next_action.review_approve"
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

			<section className="bg-white border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-slate-500">{t("docs_view.address")}:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				{doc.avisoNumber && (
					<p>
						<span className="text-slate-500">
							{t("docs_view.aviso_number")}:
						</span>{" "}
						{doc.avisoNumber}
					</p>
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
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.materials_used")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={used}
						readOnly
					/>
					{doc.fieldNotes && (
						<p className="text-sm text-slate-600 mt-2">{doc.fieldNotes}</p>
					)}
				</section>
			)}

			{nextHref && (
				<Link to={nextHref} className={buttonVariants({ className: "w-full" })}>
					{t(nextActionLabelKey(doc.status))}
				</Link>
			)}

			{(user.role === "SUPERVISOR" || user.role === "ADMIN") &&
				(doc.status === "CREATED" || doc.status === "PREPPED") && (
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

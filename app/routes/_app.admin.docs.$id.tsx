import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.docs.$id"

const STATUS_BADGE_VARIANT: Record<string, "ok" | "warn" | "danger" | "info"> =
	{
		CREATED: "info",
		PREPPED: "info",
		SIGNED: "info",
		FIELD_UPDATED: "warn",
		SUPERVISOR_APPROVED: "ok",
		CLARO_UPLOADED: "ok",
		LC_REQUEST_GENERATED: "ok",
		CANCELLED: "danger",
	}

interface UserInfo {
	id: string
	name: string
	role: string
}

type MaterialLine = { serviceCodeId: string; qty: number }

type SendBackEntry = {
	createdAt: string
	byUserId: string
	fromStatus: string
	toStatus: string
	note: string
}

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

type AuditDiff = {
	status?: { before?: string; after?: string }
	note?: string
	materialsChanged?: boolean
	avisoNumber?: string
	to?: string[]
	reason?: string
}

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			auditTrail: {
				include: { user: { select: { id: true, name: true } } },
				orderBy: { timestamp: "asc" },
			},
			paymentRecords: {
				orderBy: { date: "asc" },
				include: { recordedBy: { select: { id: true, name: true } } },
			},
		},
	})

	const sendBack =
		(doc.sendBackHistory as unknown as SendBackEntry[] | null) ?? []
	const knownIds = [
		doc.supervisorId,
		doc.preppedById,
		doc.releasedById,
		doc.signedById,
		doc.overriddenById,
		doc.cancelledById,
		doc.lcApprovedById,
		doc.receivableClosedById,
		...doc.assignedCrewIds,
		...sendBack.map((s) => s.byUserId),
	].filter((id): id is string => Boolean(id))
	const people = await db.user.findMany({
		where: { id: { in: knownIds } },
		select: { id: true, name: true, role: true },
	})
	const peopleMap = new Map(people.map((p: UserInfo) => [p.id, p]))
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})

	return {
		doc,
		sendBack,
		peopleMap: Object.fromEntries(peopleMap) as Record<string, UserInfo>,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
	}
}

function actionSummary(action: string, diffJson: AuditDiff): string {
	if (action === "STATUS_CHANGED")
		return `Status: ${diffJson.status?.before ?? "?"} → ${diffJson.status?.after ?? "?"}`
	if (action === "SEND_BACK") return `Sent back — note: ${diffJson.note ?? ""}`
	if (action === "WORK_ORDER_EDITED")
		return `Work order edited${diffJson.materialsChanged ? " (materials changed)" : ""}`
	if (action === "AVISO_NUMBER_SET")
		return `Aviso #: ${diffJson.avisoNumber ?? "—"}`
	if (action === "CREW_REASSIGNED")
		return `Crew reassigned to ${JSON.stringify(diffJson.to ?? [])}`
	if (action === "DOC_CANCELLED") return `Cancelled: ${diffJson.reason ?? ""}`
	if (action === "JAF_INVOICE_GENERATED") return "JAF invoice generated"
	return `${action}${diffJson ? ` — ${JSON.stringify(diffJson)}` : ""}`
}

export default function AdminDocHistory({ loaderData }: Route.ComponentProps) {
	const { doc, sendBack, peopleMap, serviceCodes } = loaderData
	const t = useTranslation().t
	const name = (id?: string | null) => (id ? (peopleMap[id]?.name ?? id) : "—")
	const estimated = (doc.estimatedMaterials as unknown as MaterialLine[]) || []
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const used = (doc.materialsUsed as unknown as MaterialLine[]) || []

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between">
				<div>
					<h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
					<p className="text-sm text-muted-foreground">{doc.jobType}</p>
				</div>
				<Badge variant={STATUS_BADGE_VARIANT[doc.status]}>
					{doc.status.replace(/_/g, " ")}
				</Badge>
			</div>

			<section className="grid grid-cols-2 gap-3 text-sm">
				<div className="bg-card border rounded-lg p-3">
					<span className="text-xs text-muted-foreground">
						{t("docs_view.address")}
					</span>
					<p>{doc.jobAddressEstimated}</p>
					{doc.jobAddressActual && (
						<p className="mt-1">
							<span className="text-xs text-muted-foreground">
								{t("docs_review.actual_address")}:
							</span>{" "}
							{doc.jobAddressActual}
						</p>
					)}
				</div>
				<div className="bg-card border rounded-lg p-3 space-y-1">
					<p>
						<span className="text-xs text-muted-foreground">
							{t("docs_view.supervisor")}
						</span>{" "}
						{name(doc.supervisorId)}
					</p>
					<p>
						<span className="text-xs text-muted-foreground">
							{t("docs_view.crew")}
						</span>{" "}
						{doc.assignedCrewIds.map(name).join(", ")}
					</p>
					{doc.avisoNumber && (
						<p>
							<span className="text-xs text-muted-foreground">
								{t("docs_view.aviso_number")}
							</span>
							{", "}
							{doc.avisoNumber}
						</p>
					)}
					{doc.cancelledById && (
						<p className="text-status-danger">
							Cancelled by {name(doc.cancelledById)} — {doc.cancellationReason}
						</p>
					)}
				</div>
			</section>

			<section className="bg-card border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-foreground mb-3">
					{t("admin_history.timeline_heading")}
				</h2>
				{doc.auditTrail.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t("admin_history.no_events")}
					</p>
				)}
				<ol className="relative border-l border-border ml-px">
					{doc.auditTrail.map((a) => (
						<li key={a.id} className="relative mb-4 ml-4">
							<div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-status-info" />
							<time className="text-xs text-muted-foreground">
								{new Date(a.timestamp).toLocaleString()}
							</time>
							<span className="text-xs text-muted-foreground">
								{" "}
								{a.user?.name ?? "?"}:{" "}
							</span>
							<span className="text-sm font-medium">{a.action}</span>
							{a.action !== "STATUS_CHANGED" && (
								<span className="text-sm text-foreground">
									{" — "}
									{actionSummary(a.action, a.diffJson as AuditDiff)}
								</span>
							)}
						</li>
					))}
				</ol>
			</section>

			{sendBack.length > 0 && (
				<section className="bg-card border rounded-lg p-4">
					<h2 className="text-sm font-semibold text-foreground mb-2">
						{t("admin_history.send_backs_heading")}
					</h2>
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-muted-foreground border-b">
								<th className="pb-1">Date</th>
								<th className="pb-1">From</th>
								<th className="pb-1">To</th>
								<th className="pb-1">By</th>
								<th className="pb-1">Note</th>
							</tr>
						</thead>
						<tbody>
							{sendBack.map((s) => (
								<tr
									key={`${s.createdAt}-${s.byUserId}`}
									className="border-b last:border-0"
								>
									<td className="py-1">
										{new Date(s.createdAt).toLocaleString()}
									</td>
									<td>{s.fromStatus}</td>
									<td>{s.toStatus}</td>
									<td>{name(s.byUserId)}</td>
									<td>{s.note}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			)}

			<section className="bg-card border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-foreground mb-2">
					{t("admin_history.payments_heading")}
				</h2>
				{doc.paymentRecords.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("admin_history.no_payments")}
					</p>
				) : (
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-muted-foreground border-b">
								<th className="pb-1">Date</th>
								<th className="pb-1">Type</th>
								<th className="pb-1 text-right">Amount</th>
								<th className="pb-1">Recorded by</th>
								<th className="pb-1">Note</th>
							</tr>
						</thead>
						<tbody>
							{doc.paymentRecords.map((pr) => (
								<tr key={pr.id} className="border-b last:border-0">
									<td className="py-1">
										{new Date(pr.date).toLocaleDateString()}
									</td>
									<td>{pr.type}</td>
									<td className="text-right">
										{formatMoney(toNumberPrice(pr.amount))}
									</td>
									<td>{pr.recordedBy?.name ?? "—"}</td>
									<td>{pr.note ?? ""}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				{(doc.advanceAmount || doc.finalPaymentAmount) && (
					<div className="grid grid-cols-2 gap-2 mt-3 text-xs">
						{doc.advanceAmount ? (
							<div>
								Advance: {formatMoney(toNumberPrice(doc.advanceAmount))}{" "}
								{doc.advanceReceivedAt &&
									new Date(doc.advanceReceivedAt).toLocaleDateString()}
							</div>
						) : null}
						{doc.finalPaymentAmount ? (
							<div>
								Final: {formatMoney(toNumberPrice(doc.finalPaymentAmount))}{" "}
								{doc.finalPaymentReceivedAt &&
									new Date(doc.finalPaymentReceivedAt).toLocaleDateString()}
							</div>
						) : null}
					</div>
				)}
			</section>

			{(estimated.length > 0 || taken.length > 0 || used.length > 0) && (
				<section className="bg-card border rounded-lg p-4 space-y-4">
					<h2 className="text-sm font-semibold text-foreground">
						{t("admin_history.materials_heading")}
					</h2>
					{estimated.length > 0 && (
						<>
							<p className="text-xs text-muted-foreground">
								{t("docs_review.estimated")}
							</p>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={estimated}
								readOnly
							/>
						</>
					)}
					{taken.length > 0 && (
						<>
							<p className="text-xs text-muted-foreground">
								{t("docs_review.taken")}
							</p>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={taken}
								readOnly
							/>
						</>
					)}
					{used.length > 0 && (
						<>
							<p className="text-xs text-muted-foreground">
								{t("docs_review.used")}
							</p>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={used}
								readOnly
							/>
						</>
					)}
				</section>
			)}

			<section className="bg-card border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-foreground mb-2">
					{t("admin_history.documents_heading")}
				</h2>
				<ul className="text-sm space-y-1">
					{doc.warehouseReceiptPath && (
						<li>
							<a
								href={`/files/receipts/${doc.id}-receipt.pdf`}
								className="text-primary underline"
							>
								{t("admin_history.warehouse_receipt")}
							</a>
						</li>
					)}
					{doc.jafInvoicePdfPath && (
						<li>
							<a
								href={`/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`}
								className="text-primary underline"
							>
								{t("admin_history.jaf_invoice")}
							</a>
						</li>
					)}
					{doc.claroPdfPath && (
						<li>
							<a
								href={`/files/claro-pdfs/${doc.id}-claro.pdf`}
								className="text-primary underline"
							>
								{t("admin_history.claro_work_order")}
							</a>
						</li>
					)}
					{doc.lcGeneratedAt && (
						<li>
							<Link
								to={`/docs/${doc.id}/lc`}
								className="text-primary underline"
							>
								{t("admin_history.lc_request")}
							</Link>
						</li>
					)}
				</ul>
			</section>

			<div>
				<Link
					to={`/docs/${doc.id}`}
					className={buttonVariants({ variant: "outline" })}
				>
					{t("admin_history.back_to_work_order")}
				</Link>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

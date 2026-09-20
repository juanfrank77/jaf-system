import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { describeAuditEvent } from "~/lib/audit-event"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { ServiceLine } from "~/lib/service-lines"
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

function statusLabelKey(status: string | null | undefined): ParseKeys {
	if (status && STATUS_LABEL_KEY[status]) return STATUS_LABEL_KEY[status]
	return "admin_history.detail.unknown_status"
}

export default function AdminDocHistory({ loaderData }: Route.ComponentProps) {
	const { doc, sendBack, peopleMap, serviceCodes } = loaderData
	const { t } = useTranslation()
	const name = (id?: string | null) => (id ? (peopleMap[id]?.name ?? id) : "—")
	const estimated = (doc.estimatedMaterials as unknown as MaterialLine[]) || []
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const used = (doc.materialsUsed as unknown as MaterialLine[]) || []
	const billedLines = (doc.serviceLines as unknown as ServiceLine[]) || []
	const translate = (key: string, options?: Record<string, unknown>) =>
		t(key as ParseKeys, options)

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between">
				<div>
					<h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
					<p className="text-sm text-slate-500">{doc.jobType}</p>
				</div>
				<Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? "info"}>
					{t(statusLabelKey(doc.status))}
				</Badge>
			</div>

			<section className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
				<div className="bg-white border rounded-lg p-3">
					<span className="text-xs text-slate-500">
						{t("docs_view.address")}
					</span>
					<p>{doc.jobAddressEstimated}</p>
					{doc.jobAddressActual && (
						<p className="mt-1">
							<span className="text-xs text-slate-500">
								{t("docs_review.actual_address")}:
							</span>{" "}
							{doc.jobAddressActual}
						</p>
					)}
				</div>
				<div className="bg-white border rounded-lg p-3 space-y-1">
					<p>
						<span className="text-xs text-slate-500">
							{t("docs_view.supervisor")}
						</span>{" "}
						{name(doc.supervisorId)}
					</p>
					<p>
						<span className="text-xs text-slate-500">
							{t("docs_view.crew")}
						</span>{" "}
						{doc.assignedCrewIds.length > 0
							? doc.assignedCrewIds.map(name).join(", ")
							: "—"}
					</p>
					{doc.avisoNumber && (
						<p>
							<span className="text-xs text-slate-500">
								{t("docs_view.aviso_number")}
							</span>
							{", "}
							{doc.avisoNumber}
						</p>
					)}
					{doc.cancelledById && (
						<p className="text-red-700">
							Cancelled by {name(doc.cancelledById)} — {doc.cancellationReason}
						</p>
					)}
				</div>
			</section>

			<section className="bg-white border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-slate-700 mb-3">
					{t("admin_history.timeline_heading")}
				</h2>
				{doc.auditTrail.length === 0 && (
					<p className="text-sm text-slate-400">
						{t("admin_history.no_events")}
					</p>
				)}
				<ol className="relative space-y-5 border-l border-slate-200 pl-4">
					{doc.auditTrail.map((a) => {
						const event = describeAuditEvent(a.action, a.diffJson, {
							t: translate,
							statusLabel: (status) => t(statusLabelKey(status)),
							nameOf: (id) => name(id),
							formatMoney,
						})
						const title = t(event.titleKey, event.titleValues)
						return (
							<li key={a.id} className="relative">
								<div className="absolute top-1.5 -left-[21px] h-3 w-3 rounded-full bg-blue-500" />
								<p className="text-sm font-medium text-slate-900">{title}</p>
								{event.detail && (
									<p className="text-sm text-slate-700">{event.detail}</p>
								)}
								{event.items && event.items.length > 0 && (
									<ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">
										{event.items.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								)}
								<p className="mt-0.5 text-xs text-slate-500">
									<time>{new Date(a.timestamp).toLocaleString()}</time>
									{" · "}
									{a.user?.name ?? t("admin_history.unknown_actor")}
								</p>
							</li>
						)
					})}
				</ol>
			</section>

			{sendBack.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-semibold text-slate-700 mb-2">
						{t("admin_history.send_backs_heading")}
					</h2>
					<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead>
								<tr className="text-left text-slate-500 border-b">
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
					</div>
				</section>
			)}

			<section className="bg-white border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-slate-700 mb-2">
					{t("admin_history.payments_heading")}
				</h2>
				{doc.paymentRecords.length === 0 ? (
					<p className="text-sm text-slate-400">
						{t("admin_history.no_payments")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead>
								<tr className="text-left text-slate-500 border-b">
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
					</div>
				)}
				{(doc.advanceAmount || doc.finalPaymentAmount) && (
					<div className="grid grid-cols-1 gap-2 mt-3 text-xs sm:grid-cols-2">
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

			{billedLines.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-semibold text-slate-700 mb-2">
						{t("admin_history.service_lines_heading")}
					</h2>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-xs text-slate-500 border-b">
									<th className="py-1">{t("service_picker.col_code")}</th>
									<th className="py-1">
										{t("service_picker.col_description")}
									</th>
									<th className="py-1 text-right">{t("service_picker.qty")}</th>
								</tr>
							</thead>
							<tbody>
								{billedLines.map((line) => (
									<tr
										key={line.serviceCodeId}
										className="border-b last:border-0"
									>
										<td className="py-1 font-mono text-xs">{line.claroCode}</td>
										<td className="py-1">{line.name}</td>
										<td className="py-1 text-right">{line.qty}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{(estimated.length > 0 || taken.length > 0 || used.length > 0) && (
				<section className="bg-white border rounded-lg p-4 space-y-4">
					<h2 className="text-sm font-semibold text-slate-700">
						{t("admin_history.materials_heading")}
					</h2>
					{estimated.length > 0 && (
						<>
							<p className="text-xs text-slate-500">
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
							<p className="text-xs text-slate-500">{t("docs_review.taken")}</p>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={taken}
								readOnly
							/>
						</>
					)}
					{used.length > 0 && (
						<>
							<p className="text-xs text-slate-500">{t("docs_review.used")}</p>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={used}
								readOnly
							/>
						</>
					)}
				</section>
			)}

			<section className="bg-white border rounded-lg p-4">
				<h2 className="text-sm font-semibold text-slate-700 mb-2">
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

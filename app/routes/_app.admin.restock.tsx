import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.restock"

type StockLevel = {
	serviceCodeId: string
	qty: number
}

type RestockItem = {
	serviceCodeId: string
	qty: number
}

type RestockRequest = {
	id: string
	status: string
	items: unknown
	requestedBy: { name: string } | null
	warehouse: { name: string } | null
	approvedBy: { name: string } | null
	approvalNote: string | null
	deniedReason: string | null
	vanName: string | null
	exceeds: boolean
}

export const meta: Route.MetaFunction = () => [
	{ title: "Restock Sign-offs — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN", "SUPERVISOR"])

	const [requests, vans, serviceCodes] = await Promise.all([
		db.vanRestockRequest.findMany({
			where: {
				status: { in: ["REQUESTED", "PENDING_APPROVAL", "APPROVED", "DENIED"] },
			},
			orderBy: { createdAt: "desc" },
			include: { requestedBy: true, warehouse: true, approvedBy: true },
			take: 100,
		}),
		db.van.findMany({ where: { active: true } }),
		db.serviceCode.findMany({
			where: { active: true },
			orderBy: { claroCode: "asc" },
		}),
	])

	const enriched = requests.map((req) => {
		const items = (req.items as RestockItem[]) || []
		const van = vans.find((v) => v.installerId === req.requestedById)
		const standardLevels = (van?.standardStockLevels as StockLevel[]) || []
		const exceeds = items.some((item) => {
			const standard = standardLevels.find(
				(l) => l.serviceCodeId === item.serviceCodeId,
			)
			return item.qty > (standard?.qty ?? 0)
		})
		return { ...req, exceeds, vanName: van?.name ?? null }
	})

	return { requests: enriched, serviceCodes }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["ADMIN", "SUPERVISOR"])
	const form = await request.formData()
	const intent = form.get("intent")
	const id = form.get("id")

	if (typeof id !== "string" || !id.trim()) {
		return data(
			{ errorKey: "admin_restock.errors.id_required" },
			{ status: 400 },
		)
	}

	if (intent === "approve") {
		const note = (form.get("note") as string | null)?.trim() || null
		const existing = await db.vanRestockRequest.findUniqueOrThrow({
			where: { id },
		})
		if (existing.status !== "PENDING_APPROVAL") {
			return data(
				{ errorKey: "admin_restock.errors.invalid_status" },
				{ status: 400 },
			)
		}
		await db.vanRestockRequest.update({
			where: { id },
			data: {
				status: "APPROVED",
				requiresApproval: true,
				approvedById: user.id,
				approvalNote: note,
			},
		})
		await db.auditTrail.create({
			data: {
				docId: id,
				userId: user.id,
				action: "RESTOCK_APPROVED",
				diffJson: {
					requestId: id,
					note,
					approverId: user.id,
					approverRole: user.role,
				},
			},
		})
		return redirect("/admin/restock")
	}

	if (intent === "deny") {
		const reason = (form.get("reason") as string | null)?.trim() || ""
		if (!reason) {
			return data(
				{ errorKey: "admin_restock.errors.reason_required" },
				{ status: 400 },
			)
		}
		const existing = await db.vanRestockRequest.findUniqueOrThrow({
			where: { id },
		})
		if (existing.status !== "PENDING_APPROVAL") {
			return data(
				{ errorKey: "admin_restock.errors.invalid_status" },
				{ status: 400 },
			)
		}
		await db.vanRestockRequest.update({
			where: { id },
			data: {
				status: "DENIED",
				requiresApproval: true,
				approvedById: user.id,
				deniedReason: reason,
			},
		})
		await db.auditTrail.create({
			data: {
				docId: id,
				userId: user.id,
				action: "RESTOCK_DENIED",
				diffJson: {
					requestId: id,
					reason,
					approverId: user.id,
					approverRole: user.role,
				},
			},
		})
		return redirect("/admin/restock")
	}

	return data(
		{ errorKey: "admin_restock.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function AdminRestock({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { requests, serviceCodes } = loaderData
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null

	const pending = requests.filter((r) => r.status === "PENDING_APPROVAL")
	const decided = requests.filter((r) => r.status !== "PENDING_APPROVAL")

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("admin_restock.title")}</h1>

			{error && <p className="text-sm text-red-600">{t(error as never)}</p>}

			<section className="bg-white border rounded-lg overflow-hidden">
				<h2 className="px-4 py-3 text-base font-medium border-b">
					{t("admin_restock.pending_heading", { count: pending.length })}
				</h2>
				{pending.length === 0 ? (
					<p className="p-4 text-sm text-slate-400">
						{t("admin_restock.no_pending")}
					</p>
				) : (
					<div className="divide-y">
						{pending.map((req) => (
							<RestockRequestRow
								key={req.id}
								request={req}
								serviceCodes={serviceCodes}
								t={t}
							/>
						))}
					</div>
				)}
			</section>

			<section className="bg-white border rounded-lg overflow-hidden">
				<h2 className="px-4 py-3 text-base font-medium border-b">
					{t("admin_restock.history_heading")}
				</h2>
				{decided.length === 0 ? (
					<p className="p-4 text-sm text-slate-400">
						{t("admin_restock.no_history")}
					</p>
				) : (
					<div className="divide-y">
						{decided.map((req) => (
							<RestockRequestRow
								key={req.id}
								request={req}
								serviceCodes={serviceCodes}
								t={t}
								history
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}

function RestockRequestRow({
	request,
	serviceCodes,
	t,
	history = false,
}: {
	request: RestockRequest
	serviceCodes: {
		id: string
		claroCode: string
		name: string
		unitPrice: unknown
	}[]
	t: TFunction<"common", undefined>
	history?: boolean
}) {
	const items = (request.items as RestockItem[]) || []
	const total = items.reduce((sum, item) => {
		const code = serviceCodes.find((c) => c.id === item.serviceCodeId)
		return sum + Number(item.qty || 0) * toNumberPrice(code?.unitPrice)
	}, 0)

	return (
		<div className="p-4 space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="font-mono font-medium">#{request.id.slice(-6)}</p>
					<p className="text-sm text-slate-500">
						{request.requestedBy?.name} — {request.warehouse?.name}
						{request.vanName && ` (${request.vanName})`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{request.exceeds && (
						<Badge variant="warn">{t("admin_restock.exceeds_badge")}</Badge>
					)}
					<Badge
						variant={
							request.status === "APPROVED"
								? "ok"
								: request.status === "DENIED"
									? "danger"
									: "info"
						}
					>
						{request.status}
					</Badge>
				</div>
			</div>

			<ul className="text-sm text-slate-600 space-y-1">
				{items.map((item) => {
					const code = serviceCodes.find((c) => c.id === item.serviceCodeId)
					return (
						<li key={item.serviceCodeId}>
							{code?.claroCode ?? item.serviceCodeId} — {code?.name}: {item.qty}
						</li>
					)
				})}
				{items.length === 0 && <li>{t("admin_restock.no_items")}</li>}
			</ul>

			<p className="text-sm font-medium">
				{t("admin_restock.total")}: ${total.toFixed(2)}
			</p>

			{!history && request.status === "PENDING_APPROVAL" && (
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<Form method="post" className="space-y-2">
						<input type="hidden" name="intent" value="approve" />
						<input type="hidden" name="id" value={request.id} />
						<div className="space-y-1">
							<Label htmlFor={`note-${request.id}`}>
								{t("admin_restock.approval_note_label")}
							</Label>
							<Input
								id={`note-${request.id}`}
								name="note"
								placeholder={t("admin_restock.approval_note_placeholder")}
							/>
						</div>
						<Button type="submit" size="sm">
							{t("admin_restock.approve")}
						</Button>
					</Form>
					<Form method="post" className="space-y-2">
						<input type="hidden" name="intent" value="deny" />
						<input type="hidden" name="id" value={request.id} />
						<div className="space-y-1">
							<Label htmlFor={`reason-${request.id}`}>
								{t("admin_restock.deny_reason_label")}
							</Label>
							<Textarea
								id={`reason-${request.id}`}
								name="reason"
								rows={2}
								required
								placeholder={t("admin_restock.deny_reason_placeholder")}
							/>
						</div>
						<Button type="submit" variant="destructive" size="sm">
							{t("admin_restock.deny")}
						</Button>
					</Form>
				</div>
			)}

			{history && request.approvedBy && (
				<p className="text-xs text-slate-500">
					{t("admin_restock.decided_by", { name: request.approvedBy.name })}
					{request.approvalNote && ` — ${request.approvalNote}`}
					{request.deniedReason && ` — ${request.deniedReason}`}
				</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

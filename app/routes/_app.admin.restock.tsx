import { CheckListIcon, InboxIcon } from "@hugeicons/core-free-icons"
import type { ParseKeys, TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import {
	getVanParLevelsForVans,
	parLevelsToStockLevels,
} from "~/lib/van-stock.server"
import type { Route } from "./+types/_app.admin.restock"

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
	createdAt: Date
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

	const parLevelsByVan = await getVanParLevelsForVans(vans.map((v) => v.id))

	const enriched = requests.map((req) => {
		const items = (req.items as RestockItem[]) || []
		const van = vans.find((v) => v.installerId === req.requestedById)
		const standardLevels = van
			? parLevelsToStockLevels(parLevelsByVan.get(van.id) ?? [])
			: []
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

const STATUS_LABEL_KEY: Record<string, ParseKeys> = {
	REQUESTED: "admin_restock.status.requested",
	PENDING_APPROVAL: "admin_restock.status.pending_approval",
	APPROVED: "admin_restock.status.approved",
	DENIED: "admin_restock.status.denied",
}

function formatAge(createdAt: Date, t: TFunction) {
	const days = Math.floor((Date.now() - createdAt.getTime()) / 86_400_000)
	if (days <= 0) return t("admin_restock.age_today")
	return t("admin_restock.age", { count: days })
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
		<div>
			<PageHeader
				title={t("admin_restock.title")}
				subtitle={t("admin_restock.subtitle")}
			/>

			{error && (
				<p className="mb-4 rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
					{t(error as ParseKeys)}
				</p>
			)}

			<Tabs defaultValue="pending">
				<TabsList>
					<TabsTab value="pending" className="gap-2">
						{t("admin_restock.tab_pending")}
						<Badge variant={pending.length > 0 ? "warn" : "neutral"}>
							{pending.length}
						</Badge>
					</TabsTab>
					<TabsTab value="history">{t("admin_restock.tab_history")}</TabsTab>
				</TabsList>
				<TabsPanel value="pending">
					<Card>
						{pending.length === 0 ? (
							<EmptyState
								icon={InboxIcon}
								title={t("admin_restock.no_pending_title")}
								description={t("admin_restock.no_pending_description")}
							/>
						) : (
							<div className="divide-y divide-border">
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
					</Card>
				</TabsPanel>
				<TabsPanel value="history">
					<Card>
						{decided.length === 0 ? (
							<EmptyState
								icon={CheckListIcon}
								title={t("admin_restock.no_history_title")}
								description={t("admin_restock.no_history_description")}
							/>
						) : (
							<div className="divide-y divide-border">
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
					</Card>
				</TabsPanel>
			</Tabs>
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
		<div className="space-y-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="font-mono font-medium">#{request.id.slice(-6)}</p>
					<p className="text-sm text-muted-foreground">
						{request.requestedBy?.name} — {request.warehouse?.name}
						{request.vanName && ` (${request.vanName})`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">
						{formatAge(request.createdAt, t)}
					</span>
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
						{t(STATUS_LABEL_KEY[request.status] ?? STATUS_LABEL_KEY.REQUESTED)}
					</Badge>
				</div>
			</div>

			<ul className="space-y-1 text-sm text-muted-foreground">
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

			<p className="text-sm font-medium tabular-nums">
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
						<Button type="submit" variant="secondary" size="sm">
							{t("admin_restock.deny")}
						</Button>
					</Form>
				</div>
			)}

			{history && request.approvedBy && (
				<p className="text-xs text-muted-foreground">
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

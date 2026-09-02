import {
	ChevronRightIcon,
	FilterIcon,
	RemoveIcon,
	SearchIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Pill } from "~/components/ui/pill"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Stat } from "~/components/ui/stat"
import type {
	DashboardAlert,
	DashboardExplainer,
	DashboardStat,
} from "~/lib/dashboard-stats"
import type { DocStatus } from "../../generated/prisma/client"

type SendBackEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

function toLines(value: unknown): MaterialLine[] {
	if (!Array.isArray(value)) return []
	return value.filter((i): i is MaterialLine => {
		if (typeof i !== "object" || i === null) return false
		const item = i as Record<string, unknown>
		return (
			typeof item.serviceCodeId === "string" && typeof item.qty === "number"
		)
	})
}

function hasOverage(doc: DashboardDocRow): boolean {
	const estimated = toLines(doc.estimatedMaterials)
	const taken = toLines(doc.materialsTaken)
	if (estimated.length === 0 || taken.length === 0) return false
	const estimatedMap = Object.fromEntries(
		estimated.map((e) => [e.serviceCodeId, e.qty]),
	)
	return taken.some((t) => t.qty > (estimatedMap[t.serviceCodeId] ?? 0))
}

function hasQuantityDiscrepancy(doc: DashboardDocRow): boolean {
	const taken = toLines(doc.materialsTaken)
	const used = toLines(doc.materialsUsed)
	if (taken.length === 0 || used.length === 0) return false
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))
	const allIds = new Set([...Object.keys(takenMap), ...Object.keys(usedMap)])
	for (const id of allIds) {
		if ((takenMap[id] ?? 0) !== (usedMap[id] ?? 0)) return true
	}
	return false
}

function hasShortage(doc: DashboardDocRow): boolean {
	const returned = Array.isArray(doc.materialsReturned)
		? doc.materialsReturned
		: []
	return returned.some((line) => {
		if (typeof line !== "object" || line === null) return false
		const record = line as Record<string, unknown>
		return (
			typeof record.returnedQty === "number" &&
			typeof record.takenQty === "number" &&
			record.returnedQty < record.takenQty
		)
	})
}

type MaterialLine = { serviceCodeId: string; qty: number }

type DashboardDocRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
	avisoNumber?: string | null
	assignedCrewIds?: string[]
	sendBackHistory?: unknown
	estimatedMaterials?: unknown
	materialsTaken?: unknown
	materialsUsed?: unknown
	materialsReturned?: unknown
}

type CrewOption = { id: string; name: string }

type JobTypeOption = string

type RestockRequestRow = {
	id: string
	status: string
	createdAt: Date
	requestedBy: { name: string }
	warehouse: { name: string }
	items: unknown
}

const STATUS_BADGE_VARIANT: Record<
	DocStatus,
	"ok" | "warn" | "danger" | "info"
> = {
	CREATED: "warn",
	PREPPED: "info",
	SIGNED: "info",
	FIELD_UPDATED: "warn",
	SUPERVISOR_APPROVED: "info",
	CLARO_UPLOADED: "info",
	LC_REQUEST_GENERATED: "ok",
	CANCELLED: "danger",
}

type StatusLabelKey =
	| "dashboard.filter.status_all"
	| "docs_status.created"
	| "docs_status.prepped"
	| "docs_status.signed"
	| "docs_status.field_updated"
	| "docs_status.supervisor_approved"
	| "docs_status.claro_uploaded"
	| "docs_status.lc_request_generated"
	| "docs_status.cancelled"

const STATUS_OPTIONS: { value: string; labelKey: StatusLabelKey }[] = [
	{ value: "", labelKey: "dashboard.filter.status_all" },
	{ value: "CREATED", labelKey: "docs_status.created" },
	{ value: "PREPPED", labelKey: "docs_status.prepped" },
	{ value: "SIGNED", labelKey: "docs_status.signed" },
	{ value: "FIELD_UPDATED", labelKey: "docs_status.field_updated" },
	{ value: "SUPERVISOR_APPROVED", labelKey: "docs_status.supervisor_approved" },
	{ value: "CLARO_UPLOADED", labelKey: "docs_status.claro_uploaded" },
	{
		value: "LC_REQUEST_GENERATED",
		labelKey: "docs_status.lc_request_generated",
	},
	{ value: "CANCELLED", labelKey: "docs_status.cancelled" },
]

function DashboardView({
	stats,
	alert,
	explainer,
	docs,
	pendingReviewDocs = [],
	sentBackDocs = [],
	crewOptions = [],
	jobTypeOptions = [],
	selectedStatus = null,
	selectedCrew = null,
	selectedJobType = null,
	searchFilter = "",
	warehousePreppedDocs = [],
	warehouseMissingDocs = [],
	warehouseReturnsDocs = [],
	crewPreppedDocs = [],
	crewInFieldDocs = [],
	crewSentBackDocs = [],
	crewSubmittedDocs = [],
	restockRequests = [],
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	explainer: DashboardExplainer
	docs: DashboardDocRow[]
	pendingReviewDocs?: DashboardDocRow[]
	sentBackDocs?: DashboardDocRow[]
	crewOptions?: CrewOption[]
	jobTypeOptions?: JobTypeOption[]
	selectedStatus?: string | null
	selectedCrew?: string | null
	selectedJobType?: string | null
	searchFilter?: string
	warehousePreppedDocs?: DashboardDocRow[]
	warehouseMissingDocs?: DashboardDocRow[]
	warehouseReturnsDocs?: DashboardDocRow[]
	crewPreppedDocs?: DashboardDocRow[]
	crewInFieldDocs?: DashboardDocRow[]
	crewSentBackDocs?: DashboardDocRow[]
	crewSubmittedDocs?: DashboardDocRow[]
	restockRequests?: RestockRequestRow[]
}) {
	const { t } = useTranslation()
	const location = useLocation()

	const hasActiveFilters =
		!!selectedStatus || !!selectedCrew || !!selectedJobType || !!searchFilter

	const latestSendBack = (doc: DashboardDocRow): SendBackEntry | null => {
		const raw = doc.sendBackHistory
		if (raw == null || !Array.isArray(raw)) return null
		const history = raw as SendBackEntry[]
		if (history.length === 0) return null
		return history[history.length - 1]
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
				{hasActiveFilters && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							window.location.href = location.pathname
						}}
						className="text-xs"
					>
						<HugeiconsIcon
							icon={RemoveIcon}
							strokeWidth={2}
							className="size-3 mr-1"
						/>
						{t("dashboard.filter.clear_all")}
					</Button>
				)}
			</div>

			<div className="bg-white border rounded-lg p-3 space-y-3">
				<div className="flex items-center gap-2 text-sm font-medium text-slate-600">
					<HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-4" />
					{t("dashboard.filter.heading")}
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
					<Select
						value={selectedStatus || ""}
						onValueChange={(v) => {
							const params = new URLSearchParams(location.search)
							if (v) params.set("status", v)
							else params.delete("status")
							const query = params.toString()
							window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
						}}
					>
						<SelectTrigger className="w-full">
							<SelectValue
								placeholder={t("dashboard.filter.status_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{STATUS_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{t(opt.labelKey)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						value={selectedCrew || ""}
						onValueChange={(v) => {
							const params = new URLSearchParams(location.search)
							if (v) params.set("crew", v)
							else params.delete("crew")
							const query = params.toString()
							window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
						}}
						disabled={crewOptions.length === 0}
					>
						<SelectTrigger className="w-full">
							<SelectValue
								placeholder={t("dashboard.filter.crew_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{crewOptions.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						value={selectedJobType || ""}
						onValueChange={(v) => {
							const params = new URLSearchParams(location.search)
							if (v) params.set("jobType", v)
							else params.delete("jobType")
							const query = params.toString()
							window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
						}}
						disabled={!(jobTypeOptions && jobTypeOptions.length > 0)}
					>
						<SelectTrigger className="w-full">
							<SelectValue
								placeholder={t("dashboard.filter.job_type_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{(jobTypeOptions || []).map((jt) => (
								<SelectItem key={jt} value={jt}>
									{jt}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<form
						method="get"
						className="relative"
						onSubmit={(e) => {
							e.preventDefault()
							const formData = new FormData(e.currentTarget)
							const search = (formData.get("search") as string).trim()
							const params = new URLSearchParams(location.search)
							if (search) params.set("search", search)
							else params.delete("search")
							const query = params.toString()
							window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
						}}
					>
						<HugeiconsIcon
							icon={SearchIcon}
							strokeWidth={2}
							className="absolute left-2.5 top-2.5 size-4 text-slate-400"
						/>
						<Input
							name="search"
							type="search"
							placeholder={t("dashboard.filter.search_placeholder")}
							defaultValue={searchFilter}
							className="pl-9"
						/>
					</form>
				</div>
			</div>

			{stats.length > 0 && (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					{stats.map((stat) => (
						<Stat
							key={stat.labelKey}
							label={t(stat.labelKey)}
							value={stat.value}
						/>
					))}
				</div>
			)}

			{alert && (
				<Pill
					variant={alert.variant}
					icon={alert.variant === "warn" ? "⚠" : "🔔"}
				>
					{t(alert.key, { count: alert.count })}
				</Pill>
			)}
			{explainer && (
				<p className="text-xs text-muted-foreground">{t(explainer.labelKey)}</p>
			)}

			{pendingReviewDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.pending_review_heading", {
								count: pendingReviewDocs.length,
							})}
						</h2>
						<Badge variant="warn">{pendingReviewDocs.length}</Badge>
					</div>
					{pendingReviewDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/review`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<span className="text-muted-foreground truncate">
									{doc.jobType} — {doc.jobAddressEstimated}
								</span>
							</div>
						</Link>
					))}
				</div>
			)}

			{sentBackDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.sent_back_heading", {
								count: sentBackDocs.length,
							})}
						</h2>
						<Badge variant="warn">{sentBackDocs.length}</Badge>
					</div>
					{sentBackDocs.map((doc) => {
						const latest = latestSendBack(doc)
						return (
							<Link
								key={doc.id}
								to={`/docs/${doc.id}`}
								className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono font-medium">
										{doc.controlNumber}
									</span>
									<Badge variant="warn">{t("dashboard.sent_back_badge")}</Badge>
								</div>
								{latest && (
									<p className="mt-1 text-xs text-slate-600 line-clamp-2">
										{t("dashboard.sent_back_note", {
											note: latest.note,
										})}
									</p>
								)}
								<p className="mt-1 text-xs text-muted-foreground/70">
									{doc.jobType} — {doc.jobAddressEstimated}
								</p>
							</Link>
						)
					})}
				</div>
			)}

			{crewPreppedDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.ready_for_pickup_heading", {
								count: crewPreppedDocs.length,
							})}
						</h2>
						<Badge variant="info">{crewPreppedDocs.length}</Badge>
					</div>
					{crewPreppedDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/sign`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="info">
									{t("dashboard.ready_for_pickup_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{crewInFieldDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.in_the_field_heading", {
								count: crewInFieldDocs.length,
							})}
						</h2>
						<Badge variant="warn">{crewInFieldDocs.length}</Badge>
					</div>
					{crewInFieldDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/field`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="warn">
									{t("dashboard.in_the_field_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{crewSentBackDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.crew_sent_back_heading", {
								count: crewSentBackDocs.length,
							})}
						</h2>
						<Badge variant="warn">{crewSentBackDocs.length}</Badge>
					</div>
					{crewSentBackDocs.map((doc) => {
						const latest = latestSendBack(doc)
						return (
							<Link
								key={doc.id}
								to={`/docs/${doc.id}/field`}
								className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono font-medium">
										{doc.controlNumber}
									</span>
									<Badge variant="warn">{t("dashboard.sent_back_badge")}</Badge>
								</div>
								{latest && (
									<p className="mt-1 text-xs text-slate-600 line-clamp-2">
										{t("dashboard.sent_back_note", {
											note: latest.note,
										})}
									</p>
								)}
								<p className="mt-1 text-xs text-muted-foreground/70">
									{doc.jobType} — {doc.jobAddressEstimated}
								</p>
							</Link>
						)
					})}
				</div>
			)}

			{crewSubmittedDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.submitted_heading", {
								count: crewSubmittedDocs.length,
							})}
						</h2>
						<Badge variant="info">{crewSubmittedDocs.length}</Badge>
					</div>
					{crewSubmittedDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="info">{t("dashboard.submitted_badge")}</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{warehousePreppedDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.prepped_awaiting_heading", {
								count: warehousePreppedDocs.length,
							})}
						</h2>
						<Badge variant="info">{warehousePreppedDocs.length}</Badge>
					</div>
					{warehousePreppedDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/sign`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="info">
									{t("dashboard.prepped_awaiting_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{warehouseMissingDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.missing_materials_heading", {
								count: warehouseMissingDocs.length,
							})}
						</h2>
						<Badge variant="danger">{warehouseMissingDocs.length}</Badge>
					</div>
					{warehouseMissingDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/prep`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="danger">
									{t("dashboard.missing_materials_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{warehouseReturnsDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.returns_to_log_heading", {
								count: warehouseReturnsDocs.length,
							})}
						</h2>
						<Badge variant="warn">{warehouseReturnsDocs.length}</Badge>
					</div>
					{warehouseReturnsDocs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}/returns`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant="warn">
									{t("dashboard.returns_to_log_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</Link>
					))}
				</div>
			)}

			{restockRequests.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.restock_requests_heading", {
								count: restockRequests.length,
							})}
						</h2>
						<Badge variant="warn">{restockRequests.length}</Badge>
					</div>
					{restockRequests.map((req) => (
						<Link
							key={req.id}
							to={`/restock/${req.id}/fulfill`}
							className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									#{req.id.slice(-6)}
								</span>
								<Badge variant="warn">
									{t("dashboard.restock_requests_badge")}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{req.requestedBy?.name ?? "Installer"} —{" "}
								{req.warehouse?.name ?? "Warehouse"}
							</p>
						</Link>
					))}
				</div>
			)}

			<Card>
				<CardContent className="space-y-2 p-3">
					{docs.length === 0 && (
						<p className="p-2 text-sm text-muted-foreground">
							{t("dashboard.no_documents")}
						</p>
					)}
					{docs.map((doc) => {
						const overage = hasOverage(doc)
						const discrepancy = hasQuantityDiscrepancy(doc)
						const shortage = hasShortage(doc)
						return (
							<Link
								key={doc.id}
								to={`/docs/${doc.id}`}
								className="block rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/40"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-sm font-medium">
										{doc.controlNumber}
									</span>
									<div className="flex items-center gap-2">
										<Badge variant={STATUS_BADGE_VARIANT[doc.status]}>
											{doc.status.replace(/_/g, " ")}
										</Badge>
										<HugeiconsIcon
											icon={ChevronRightIcon}
											strokeWidth={2}
											className="size-4 shrink-0 text-muted-foreground"
										/>
									</div>
								</div>
								<p className="mt-1 text-sm text-muted-foreground">
									{doc.jobType} — {doc.jobAddressEstimated}
								</p>
								{(overage || discrepancy || shortage) && (
									<div className="mt-2 flex flex-wrap items-center gap-1">
										{overage && (
											<Badge variant="danger" className="text-xs">
												{t("dashboard.signal.overage")}
											</Badge>
										)}
										{discrepancy && (
											<Badge variant="warn" className="text-xs">
												{t("dashboard.signal.discrepancy")}
											</Badge>
										)}
										{shortage && (
											<Badge variant="info" className="text-xs">
												{t("dashboard.signal.shortage")}
											</Badge>
										)}
										<span className="ml-1 text-xs font-medium text-primary">
											{t("dashboard.action.review_signal")}
										</span>
									</div>
								)}
								{doc.avisoNumber && (
									<p className="mt-1 text-xs text-muted-foreground/70">
										{t("dashboard.aviso_number")} {doc.avisoNumber}
									</p>
								)}
								{doc.createdAt && (
									<p className="mt-1 text-xs text-muted-foreground/70">
										{doc.createdAt.toLocaleDateString()}
									</p>
								)}
							</Link>
						)
					})}
				</CardContent>
			</Card>
		</div>
	)
}

export { DashboardView }

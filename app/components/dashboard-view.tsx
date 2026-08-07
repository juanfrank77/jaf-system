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
import type { DashboardAlert, DashboardStat } from "~/lib/dashboard-stats"
import type { DocStatus } from "../../generated/prisma/client"

type SendBackEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

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
}

type CrewOption = { id: string; name: string }

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
	LC_GENERATED: "ok",
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
	| "docs_status.lc_generated"
	| "docs_status.cancelled"

const STATUS_OPTIONS: { value: string; labelKey: StatusLabelKey }[] = [
	{ value: "", labelKey: "dashboard.filter.status_all" },
	{ value: "CREATED", labelKey: "docs_status.created" },
	{ value: "PREPPED", labelKey: "docs_status.prepped" },
	{ value: "SIGNED", labelKey: "docs_status.signed" },
	{ value: "FIELD_UPDATED", labelKey: "docs_status.field_updated" },
	{ value: "SUPERVISOR_APPROVED", labelKey: "docs_status.supervisor_approved" },
	{ value: "CLARO_UPLOADED", labelKey: "docs_status.claro_uploaded" },
	{ value: "LC_GENERATED", labelKey: "docs_status.lc_generated" },
	{ value: "CANCELLED", labelKey: "docs_status.cancelled" },
]

function DashboardView({
	stats,
	alert,
	docs,
	pendingReviewDocs = [],
	sentBackDocs = [],
	crewOptions = [],
	selectedStatus = null,
	selectedCrew = null,
	searchFilter = "",
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	docs: DashboardDocRow[]
	pendingReviewDocs?: DashboardDocRow[]
	sentBackDocs?: DashboardDocRow[]
	crewOptions?: CrewOption[]
	selectedStatus?: string | null
	selectedCrew?: string | null
	searchFilter?: string
}) {
	const { t } = useTranslation()
	const location = useLocation()

	const hasActiveFilters = !!selectedStatus || !!selectedCrew || !!searchFilter

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

					<form
						method="get"
						className="relative sm:col-span-2"
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

			<Card>
				<CardContent className="space-y-2 p-3">
					{docs.length === 0 && (
						<p className="p-2 text-sm text-muted-foreground">
							{t("dashboard.no_documents")}
						</p>
					)}
					{docs.map((doc) => (
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
					))}
				</CardContent>
			</Card>
		</div>
	)
}

export { DashboardView }

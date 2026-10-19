import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import {
	DashboardDocList,
	type DashboardDocRow,
} from "~/components/dashboard-doc-list"
import {
	ClearFiltersButton,
	type CrewOption,
	DashboardFilters,
	hasActiveFilters,
	type JobTypeOption,
} from "~/components/dashboard-filters"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import { Pill } from "~/components/ui/pill"
import { Stat } from "~/components/ui/stat"
import { WarehouseDocList } from "~/components/warehouse-doc-list"
import type {
	DashboardAlert,
	DashboardExplainer,
	DashboardStat,
} from "~/lib/dashboard-stats"
import type { WarehouseQueue } from "~/lib/warehouse-queues"

type SendBackEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

function DashboardView({
	stats,
	alert,
	explainer,
	docs,
	showFilters = false,
	showBilling = true,
	financeSteps = false,
	showDocList = true,
	intro,
	pendingReviewDocs = [],
	sentBackDocs = [],
	crewOptions = [],
	jobTypeOptions = [],
	selectedStatus = null,
	selectedCrew = null,
	selectedJobType = null,
	searchFilter = "",
	warehouseToPrepDocs = [],
	warehouseTriageCount = 0,
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	explainer: DashboardExplainer
	docs: DashboardDocRow[]
	showFilters?: boolean
	showBilling?: boolean
	/** Badge released jobs with their Finance step (Finance and admin). */
	financeSteps?: boolean
	/** The all-documents list at the foot. Warehouse works from queues only. */
	showDocList?: boolean
	/** Rail + callout slot under the title. */
	intro?: ReactNode
	pendingReviewDocs?: DashboardDocRow[]
	sentBackDocs?: DashboardDocRow[]
	crewOptions?: CrewOption[]
	jobTypeOptions?: JobTypeOption[]
	selectedStatus?: string | null
	selectedCrew?: string | null
	selectedJobType?: string | null
	searchFilter?: string
	warehouseToPrepDocs?: DashboardDocRow[]
	warehouseCounts?: Record<WarehouseQueue, number>
	warehouseTriageCount?: number
}) {
	const { t } = useTranslation()

	const filtersActive = hasActiveFilters({
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
	})

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
				{showFilters && filtersActive && <ClearFiltersButton />}
			</div>

			{showFilters && (
				<DashboardFilters
					crewOptions={crewOptions}
					jobTypeOptions={jobTypeOptions}
					selectedStatus={selectedStatus}
					selectedCrew={selectedCrew}
					selectedJobType={selectedJobType}
					searchFilter={searchFilter}
				/>
			)}

			{intro}

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
									<p className="mt-1 text-xs text-muted-foreground line-clamp-2">
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

			{warehouseToPrepDocs.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.to_prep_heading", {
								count: warehouseToPrepDocs.length,
							})}
						</h2>
						<Badge variant="warn">{warehouseToPrepDocs.length}</Badge>
					</div>
					<WarehouseDocList docs={warehouseToPrepDocs} kind="prep" />
				</div>
			)}

			{warehouseTriageCount > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.triage_awaiting_heading", {
								count: warehouseTriageCount,
							})}
						</h2>
						<Badge variant="warn">{warehouseTriageCount}</Badge>
					</div>
					<Link
						to="/warehouse/triage"
						className={buttonVariants({ size: "lg", className: "w-full" })}
					>
						{t("dashboard.triage_awaiting_cta")}
						<HugeiconsIcon icon={ArrowRight01Icon} />
					</Link>
				</div>
			)}

			{showDocList && (
				<DashboardDocList
					docs={docs}
					showBilling={showBilling}
					financeSteps={financeSteps}
				/>
			)}
		</div>
	)
}

export { DashboardView }

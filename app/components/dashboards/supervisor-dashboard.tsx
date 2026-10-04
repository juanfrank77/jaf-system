import type { ParseKeys, TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { DashboardDocList } from "~/components/dashboard-doc-list"
import {
	ClearFiltersButton,
	DashboardFilters,
	hasActiveFilters,
} from "~/components/dashboard-filters"
import { Badge } from "~/components/ui/badge"
import { PageHeader } from "~/components/ui/page-header"
import { Pill } from "~/components/ui/pill"
import { QueueCard } from "~/components/ui/queue-card"
import { Stat } from "~/components/ui/stat"
import type { SupervisorStage } from "~/lib/supervisor-stage"
import { formatMoney } from "~/lib/utils"
import type { DashboardViewProps } from "./types"

type QueueRow = {
	id: string
	controlNumber: string
	jobAddressEstimated: string
	jobAddressActual: string | null
	brigadeName: string | null
	stage: SupervisorStage
	amount: number | null
	note?: string | null
	/** When the job entered this queue (submitted / returned / approved). */
	since: Date | string | null
	qtyDiscrepancy: boolean
}
export type SupervisorScope = { areas: string[]; brigadeCount: number }
export type SupervisorQueues = {
	pendingReview: QueueRow[]
	sentBack: QueueRow[]
	missingAviso: QueueRow[]
	blocked: QueueRow[]
}

const STAGE_KEY: Record<SupervisorStage, ParseKeys> = {
	INTAKE: "step_rail.intake",
	WAREHOUSE: "step_rail.warehouse",
	FIELD: "step_rail.field",
	APPROVE: "step_rail.approve",
	INVOICE: "step_rail.invoice",
	AVISO: "step_rail.aviso",
	PRECERT: "step_rail.precert",
	RELEASE: "step_rail.release",
	RELEASED: "step_rail.released",
}

type SinceKind = "submitted" | "returned" | "approved"

function ago(t: TFunction, since: Date | string, now = Date.now()) {
	const minutes = Math.max(
		0,
		Math.floor((now - new Date(since).getTime()) / 60000),
	)
	if (minutes < 1) return t("dashboard.ago.just_now")
	if (minutes < 60) return t("dashboard.ago.minutes", { count: minutes })
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return t("dashboard.ago.hours", { count: hours })
	return t("dashboard.ago.days", { count: Math.floor(hours / 24) })
}

function titleCase(area: string) {
	return area.charAt(0) + area.slice(1).toLowerCase()
}

function Queue({
	titleKey,
	rows,
	variant,
	href,
	since,
}: {
	titleKey: ParseKeys
	rows: QueueRow[]
	variant: "warn" | "danger" | "info"
	href: (r: QueueRow) => string
	since: SinceKind
}) {
	const { t } = useTranslation()
	return (
		<QueueCard
			title={t(titleKey)}
			count={rows.length}
			variant={variant}
			empty={t("dashboard.queue.empty")}
		>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-xs text-muted-foreground text-left border-b">
						<th className="py-1">{t("dashboard.col.work_order")}</th>
						<th className="py-1">{t("dashboard.col.address")}</th>
						<th className="py-1">{t("dashboard.col.crew")}</th>
						<th className="py-1">{t("dashboard.col.stage")}</th>
						<th className="py-1 text-right">
							{t("dashboard.col.jaf_invoice")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
							<td className="py-1.5 font-mono">
								<Link to={href(r)} className="underline">
									{r.controlNumber}
								</Link>
							</td>
							<td className="py-1.5 truncate max-w-[16rem]">
								{r.jobAddressActual ?? r.jobAddressEstimated}
							</td>
							<td className="py-1.5">{r.brigadeName ?? "—"}</td>
							<td className="py-1.5">
								{t(STAGE_KEY[r.stage])}
								{r.since ? (
									<span className="block text-xs text-muted-foreground">
										{t(`dashboard.since.${since}`, { ago: ago(t, r.since) })}
									</span>
								) : null}
								{r.qtyDiscrepancy ? (
									<Badge variant="warn" className="mt-1 text-xs">
										{t("dashboard.signal.discrepancy")}
									</Badge>
								) : null}
								{r.note ? (
									<span className="block text-xs text-status-warn">
										{r.note}
									</span>
								) : null}
							</td>
							<td className="py-1.5 text-right">
								{r.amount == null ? "—" : formatMoney(r.amount)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</QueueCard>
	)
}

export function SupervisorDashboard({
	queues,
	scope,
	view,
}: {
	queues: SupervisorQueues
	scope: SupervisorScope | null
	view: DashboardViewProps
}) {
	const { t } = useTranslation()
	const {
		stats,
		alert,
		docs,
		showFilters = false,
		crewOptions,
		jobTypeOptions,
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
	} = view
	const filtersActive = hasActiveFilters({
		selectedStatus,
		selectedCrew,
		selectedJobType,
		searchFilter,
	})
	const workingStats = stats.slice(0, 4)
	const accountingStats = stats.slice(4)
	return (
		<div className="space-y-4">
			<PageHeader
				title={t("dashboard.title")}
				description={
					scope && scope.areas.length > 0
						? t("dashboard.supervisor_scope", {
								areas: scope.areas.map(titleCase).join(" + "),
								count: scope.brigadeCount,
							})
						: undefined
				}
				actions={showFilters && filtersActive ? <ClearFiltersButton /> : null}
			/>

			{alert && (
				<Pill
					variant={alert.variant}
					icon={alert.variant === "warn" ? "⚠" : "🔔"}
				>
					{t(alert.key, { count: alert.count })}
				</Pill>
			)}

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

			<div
				data-testid="supervisor-tiles"
				className="grid grid-cols-2 gap-3 md:grid-cols-4"
			>
				{workingStats.map((stat) => (
					<Stat
						key={stat.labelKey}
						label={t(stat.labelKey)}
						value={stat.value}
					/>
				))}
				<Stat
					label={t("dashboard.stat.sent_back")}
					value={queues.sentBack.length}
				/>
				<Stat
					label={t("dashboard.stat.missing_aviso")}
					value={queues.missingAviso.length}
				/>
				<Stat
					label={t("dashboard.stat.blocked")}
					value={queues.blocked.length}
				/>
			</div>

			{accountingStats.length > 0 && (
				<details data-testid="more-metrics" className="group">
					<summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
						{t("dashboard.more_metrics")}
					</summary>
					<div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
						{accountingStats.map((stat) => (
							<Stat
								key={stat.labelKey}
								label={t(stat.labelKey)}
								value={stat.value}
							/>
						))}
					</div>
				</details>
			)}

			<Queue
				titleKey="dashboard.queue.pending_review"
				rows={queues.pendingReview}
				variant="warn"
				href={(r) => `/docs/${r.id}/review`}
				since="submitted"
			/>
			<Queue
				titleKey="dashboard.queue.sent_back"
				rows={queues.sentBack}
				variant="info"
				href={(r) => `/docs/${r.id}`}
				since="returned"
			/>
			<Queue
				titleKey="dashboard.queue.missing_aviso"
				rows={queues.missingAviso}
				variant="warn"
				href={(r) => `/docs/${r.id}/review`}
				since="approved"
			/>
			<Queue
				titleKey="dashboard.queue.blocked"
				rows={queues.blocked}
				variant="danger"
				href={(r) => `/docs/${r.id}/review`}
				since="approved"
			/>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-foreground">
					{t("dashboard.all_work_orders")}
				</h2>
				<DashboardDocList docs={docs} />
			</section>
		</div>
	)
}

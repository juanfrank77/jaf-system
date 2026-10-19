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
import { OPEN_JOB_LABEL_KEYS, type OpenJobLabel } from "~/lib/open-job-label"
import type { SupervisorQueue } from "~/lib/supervisor-queues"
import type { SupervisorStage, WaitingOn } from "~/lib/supervisor-stage"
import type { DashboardViewProps } from "./types"

type QueueRow = {
	id: string
	controlNumber: string
	jobAddressEstimated: string
	jobAddressActual: string | null
	brigadeName: string | null
	stage: SupervisorStage
	note?: string | null
	/** When the job entered this queue (submitted / returned / approved). */
	since: Date | string | null
	blockReason?: "aviso_mismatch" | "billing_aviso_pdf"
	waitingOn?: WaitingOn
	/** The finer chip label (`openJobLabel`); falls back to the stage label. */
	openLabel?: OpenJobLabel
}
export type SupervisorScope = { areas: string[]; brigadeCount: number }
export type SupervisorQueues = {
	myOpen: QueueRow[]
	intake: QueueRow[]
	pendingReview: QueueRow[]
	approved: QueueRow[]
	missingAviso: QueueRow[]
	blocked: QueueRow[]
}

export const STAGE_KEY: Record<SupervisorStage, ParseKeys> = {
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

// Each count tile opens the list of jobs behind it: a sidebar-style stage queue,
// or the section further down this page when the list is already there.
const TILE_HREF: Partial<Record<string, string>> = {
	"dashboard.stat.open_documents": "/dashboard?stage=all",
	"dashboard.stat.awaiting_warehouse": "/dashboard?stage=intake",
	"dashboard.stat.awaiting_crew": "/dashboard?stage=field",
	"dashboard.stat.pending_review": "/dashboard?stage=review",
}

// Tile colors follow the queue card each count belongs to (Approved green,
// Missing aviso amber, Blocked red); the rest are blue unless they are a flag.
type StatTone = "neutral" | "ok" | "info" | "warn" | "flag"
const TILE_TONE: Partial<Record<string, StatTone>> = {
	"dashboard.stat.open_documents": "info",
	"dashboard.stat.awaiting_warehouse": "info",
	"dashboard.stat.awaiting_crew": "info",
	"dashboard.stat.pending_review": "warn",
	"dashboard.stat.missing_aviso": "warn",
	"dashboard.stat.blocked": "flag",
	"dashboard.stat.stage_awaiting_warehouse": "info",
	"dashboard.stat.stage_awaiting_crew": "info",
	"dashboard.stat.stage_pending_review": "warn",
	"dashboard.stat.stage_in_finance": "ok",
	"dashboard.stat.shortage_count": "flag",
	"dashboard.stat.overage_count": "warn",
}

type SinceKind = "created" | "submitted" | "approved"

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
	id,
	titleKey,
	rows,
	variant,
	href,
	since,
}: {
	/** Anchor for a dashboard tile that opens this list. */
	id?: string
	titleKey: ParseKeys
	rows: QueueRow[]
	variant: "ok" | "warn" | "danger" | "info"
	href: (r: QueueRow) => string
	since: SinceKind
}) {
	const { t } = useTranslation()
	return (
		<QueueCard
			id={id}
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
								{t(
									r.openLabel
										? OPEN_JOB_LABEL_KEYS[r.openLabel]
										: STAGE_KEY[r.stage],
								)}
								{r.since ? (
									<span className="block text-xs text-muted-foreground">
										{t(`dashboard.since.${since}`, { ago: ago(t, r.since) })}
									</span>
								) : null}
								{r.waitingOn ? (
									<span className="block text-xs text-muted-foreground">
										{t(`dashboard.waiting_on.${r.waitingOn}`)}
									</span>
								) : null}
								{r.blockReason ? (
									<Badge variant="danger" className="mt-1 text-xs">
										{t(`dashboard.block.${r.blockReason}`)}
									</Badge>
								) : null}
								{r.note ? (
									<span className="block text-xs text-status-warn">
										{r.note}
									</span>
								) : null}
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
	stageQueue = null,
	view,
}: {
	queues: SupervisorQueues
	scope: SupervisorScope | null
	stageQueue?: SupervisorQueue | null
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
	// A sidebar queue narrows the page to that step's work orders.
	if (stageQueue) {
		return (
			<div className="space-y-4">
				<PageHeader
					title={t(`dashboard.stage_queue.${stageQueue}`)}
					description={t("dashboard.stage_queue.count", { count: docs.length })}
					actions={
						stageQueue === "all" && showFilters && filtersActive ? (
							<ClearFiltersButton />
						) : null
					}
				/>
				{stageQueue === "all" && showFilters && (
					<DashboardFilters
						crewOptions={crewOptions}
						jobTypeOptions={jobTypeOptions}
						selectedStatus={selectedStatus}
						selectedCrew={selectedCrew}
						selectedJobType={selectedJobType}
						searchFilter={searchFilter}
					/>
				)}
				<DashboardDocList docs={docs} packetStatus={stageQueue === "invoice"} />
			</div>
		)
	}
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
			/>

			{alert && (
				<Pill
					variant={alert.variant}
					icon={alert.variant === "warn" ? "⚠" : "🔔"}
				>
					{t(alert.key, { count: alert.count })}
				</Pill>
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
						tone={TILE_TONE[stat.labelKey]}
						href={TILE_HREF[stat.labelKey]}
					/>
				))}
				<Stat
					label={t("dashboard.stat.missing_aviso")}
					tone={TILE_TONE["dashboard.stat.missing_aviso"]}
					value={queues.missingAviso.length}
					href="#missing-aviso"
				/>
				<Stat
					label={t("dashboard.stat.blocked")}
					tone={TILE_TONE["dashboard.stat.blocked"]}
					value={queues.blocked.length}
					href="#blocked"
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
								tone={TILE_TONE[stat.labelKey]}
							/>
						))}
					</div>
				</details>
			)}

			<Queue
				titleKey="dashboard.queue.intake"
				rows={queues.intake}
				variant="info"
				href={(r) => `/docs/${r.id}`}
				since="created"
			/>
			<Queue
				titleKey="dashboard.queue.pending_review"
				rows={queues.pendingReview}
				variant="warn"
				href={(r) => `/docs/${r.id}/review`}
				since="submitted"
			/>
			<Queue
				titleKey="dashboard.queue.approved"
				rows={queues.approved}
				variant="ok"
				href={(r) => `/docs/${r.id}`}
				since="approved"
			/>
			<Queue
				id="missing-aviso"
				titleKey="dashboard.queue.missing_aviso"
				rows={queues.missingAviso}
				variant="warn"
				href={(r) => `/docs/${r.id}/review`}
				since="approved"
			/>
			<Queue
				id="blocked"
				titleKey="dashboard.queue.blocked"
				rows={queues.blocked}
				variant="danger"
				href={(r) => `/docs/${r.id}/review`}
				since="approved"
			/>
			<Queue
				id="my-open"
				titleKey="dashboard.queue.my_open"
				rows={queues.myOpen}
				variant="info"
				href={(r) => `/docs/${r.id}`}
				since="created"
			/>
		</div>
	)
}

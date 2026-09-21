import {
	Alert02Icon,
	AnalyticsUpIcon,
	Clock01Icon,
	CreditCardIcon,
	DeliveryReturn01Icon,
	File01Icon,
	HardHatIcon,
	PackageIcon,
	UserIcon,
	WarehouseIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import type {
	DashboardAlert,
	DashboardStat,
	DashboardStatLabelKey,
} from "~/lib/dashboard-stats"
import {
	CompactSearchBar,
	CompactSelectFilters,
	type DashboardDocRow,
	DocRowLink,
	type Greeting,
	Hills,
	latestSendBack,
	MetricTile,
	MintAlert,
	QueueCard,
	RecentDocumentsTable,
	RoleGreeting,
	type TileTone,
} from "./role-dashboard-chrome"

type TileMeta = {
	icon: IconSvgElement
	tone: TileTone
	titleKey:
		| "dashboard.stat_title.open_jobs"
		| "dashboard.stat_title.ready_for_pickup"
		| "dashboard.stat_title.in_the_field"
		| "dashboard.stat_title.sent_back"
		| "dashboard.stat_title.submitted"
		| "dashboard.stat_title.stage_awaiting_warehouse"
		| "dashboard.stat_title.stage_awaiting_crew"
		| "dashboard.stat_title.stage_pending_review"
		| "dashboard.stat_title.stage_in_finance"
		| "dashboard.stat_title.discrepancy_count"
		| "dashboard.stat_title.shortage_count"
		| "dashboard.stat_title.overage_count"
	detailKey:
		| "dashboard.stat_detail.open_jobs"
		| "dashboard.stat_detail.ready_for_pickup"
		| "dashboard.stat_detail.in_the_field"
		| "dashboard.stat_detail.sent_back"
		| "dashboard.stat_detail.submitted"
		| "dashboard.stat_detail.stage_awaiting_warehouse"
		| "dashboard.stat_detail.stage_pending_review"
		| "dashboard.stat_detail.stage_in_finance"
		| "dashboard.stat_detail.discrepancy_count"
		| "dashboard.stat_detail.discrepancy_count_zero"
		| "dashboard.stat_detail.shortage_count"
		| "dashboard.stat_detail.shortage_count_zero"
		| "dashboard.stat_detail.overage_count"
		| "dashboard.stat_detail.overage_count_zero"
	zeroDetailKey?: TileMeta["detailKey"]
}

const TILE_META: Partial<Record<DashboardStatLabelKey, TileMeta>> = {
	"dashboard.stat.open_jobs": {
		icon: File01Icon,
		tone: "mint",
		titleKey: "dashboard.stat_title.open_jobs",
		detailKey: "dashboard.stat_detail.open_jobs",
	},
	"dashboard.stat.ready_for_pickup": {
		icon: Clock01Icon,
		tone: "mint",
		titleKey: "dashboard.stat_title.ready_for_pickup",
		detailKey: "dashboard.stat_detail.ready_for_pickup",
	},
	"dashboard.stat.in_the_field": {
		icon: HardHatIcon,
		tone: "mint",
		titleKey: "dashboard.stat_title.in_the_field",
		detailKey: "dashboard.stat_detail.in_the_field",
	},
	"dashboard.stat.sent_back": {
		icon: DeliveryReturn01Icon,
		tone: "coral",
		titleKey: "dashboard.stat_title.sent_back",
		detailKey: "dashboard.stat_detail.sent_back",
	},
	"dashboard.stat.submitted": {
		icon: File01Icon,
		tone: "purple",
		titleKey: "dashboard.stat_title.submitted",
		detailKey: "dashboard.stat_detail.submitted",
	},
	"dashboard.stat.stage_awaiting_warehouse": {
		icon: WarehouseIcon,
		tone: "mint",
		titleKey: "dashboard.stat_title.stage_awaiting_warehouse",
		detailKey: "dashboard.stat_detail.stage_awaiting_warehouse",
	},
	"dashboard.stat.stage_awaiting_crew": {
		icon: UserIcon,
		tone: "mint",
		titleKey: "dashboard.stat_title.stage_awaiting_crew",
		detailKey: "dashboard.stat_detail.ready_for_pickup",
	},
	"dashboard.stat.stage_pending_review": {
		icon: File01Icon,
		tone: "purple",
		titleKey: "dashboard.stat_title.stage_pending_review",
		detailKey: "dashboard.stat_detail.stage_pending_review",
	},
	"dashboard.stat.stage_in_finance": {
		icon: CreditCardIcon,
		tone: "mint",
		titleKey: "dashboard.stat_title.stage_in_finance",
		detailKey: "dashboard.stat_detail.stage_in_finance",
	},
	"dashboard.stat.discrepancy_count": {
		icon: Alert02Icon,
		tone: "danger",
		titleKey: "dashboard.stat_title.discrepancy_count",
		detailKey: "dashboard.stat_detail.discrepancy_count",
		zeroDetailKey: "dashboard.stat_detail.discrepancy_count_zero",
	},
	"dashboard.stat.shortage_count": {
		icon: PackageIcon,
		tone: "warn",
		titleKey: "dashboard.stat_title.shortage_count",
		detailKey: "dashboard.stat_detail.shortage_count",
		zeroDetailKey: "dashboard.stat_detail.shortage_count_zero",
	},
	"dashboard.stat.overage_count": {
		icon: AnalyticsUpIcon,
		tone: "mint",
		titleKey: "dashboard.stat_title.overage_count",
		detailKey: "dashboard.stat_detail.overage_count",
		zeroDetailKey: "dashboard.stat_detail.overage_count_zero",
	},
}

function tileHref(
	labelKey: DashboardStatLabelKey,
	value: number,
): string | undefined {
	if (value <= 0) return undefined
	switch (labelKey) {
		case "dashboard.stat.ready_for_pickup":
		case "dashboard.stat.stage_awaiting_crew":
			return "#queue-pickup"
		case "dashboard.stat.in_the_field":
			return "#queue-field"
		case "dashboard.stat.sent_back":
			return "#queue-sent-back"
		case "dashboard.stat.submitted":
			return "#queue-submitted"
		default:
			return undefined
	}
}

function alertHref(
	alert: DashboardAlert,
	crewPreppedDocs: DashboardDocRow[],
	crewInFieldDocs: DashboardDocRow[],
	crewSentBackDocs: DashboardDocRow[],
	crewSubmittedDocs: DashboardDocRow[],
): string | undefined {
	if (!alert) return undefined
	switch (alert.key) {
		case "dashboard.alert.sent_back":
			return crewSentBackDocs[0]
				? `/docs/${crewSentBackDocs[0].id}/field`
				: undefined
		case "dashboard.alert.submitted":
			return crewSubmittedDocs[0]
				? `/docs/${crewSubmittedDocs[0].id}`
				: undefined
		case "dashboard.alert.ready_for_pickup":
			return crewPreppedDocs[0]
				? `/docs/${crewPreppedDocs[0].id}/sign`
				: undefined
		case "dashboard.alert.jobs_in_field":
			return crewInFieldDocs[0]
				? `/docs/${crewInFieldDocs[0].id}/field`
				: undefined
		default:
			return undefined
	}
}

function CrewDashboard({
	stats,
	alert,
	docs,
	userName,
	greeting = "morning",
	todayIso,
	showFilters = false,
	jobTypeOptions = [],
	selectedStatus = null,
	selectedJobType = null,
	searchFilter = "",
	crewPreppedDocs = [],
	crewInFieldDocs = [],
	crewSentBackDocs = [],
	crewSubmittedDocs = [],
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	docs: DashboardDocRow[]
	userName?: string
	greeting?: Greeting
	todayIso?: string
	showFilters?: boolean
	jobTypeOptions?: string[]
	selectedStatus?: string | null
	selectedJobType?: string | null
	searchFilter?: string
	crewPreppedDocs?: DashboardDocRow[]
	crewInFieldDocs?: DashboardDocRow[]
	crewSentBackDocs?: DashboardDocRow[]
	crewSubmittedDocs?: DashboardDocRow[]
}) {
	const { t } = useTranslation()
	const href = alertHref(
		alert,
		crewPreppedDocs,
		crewInFieldDocs,
		crewSentBackDocs,
		crewSubmittedDocs,
	)

	return (
		<div className="relative">
			<Hills />
			<div className="relative">
				<div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<RoleGreeting
						userName={userName}
						greeting={greeting}
						todayIso={todayIso}
					/>
					{showFilters && (
						<CompactSearchBar
							selectedStatus={selectedStatus}
							selectedJobType={selectedJobType}
							searchFilter={searchFilter}
						/>
					)}
				</div>

				<div className="space-y-5">
					{showFilters && (
						<CompactSelectFilters
							jobTypeOptions={jobTypeOptions}
							selectedStatus={selectedStatus}
							selectedJobType={selectedJobType}
						/>
					)}

					{alert && <MintAlert alert={alert} href={href} />}

					{stats.length > 0 && (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
							{stats.map((stat) => {
								const meta = TILE_META[stat.labelKey]
								if (!meta) return null
								const detailKey =
									stat.value === 0 && meta.zeroDetailKey
										? meta.zeroDetailKey
										: meta.detailKey
								return (
									<MetricTile
										key={stat.labelKey}
										icon={meta.icon}
										tone={meta.tone}
										title={t(meta.titleKey)}
										value={stat.value}
										detail={t(detailKey)}
										href={tileHref(stat.labelKey, stat.value)}
									/>
								)
							})}
						</div>
					)}

					{(crewPreppedDocs.length > 0 ||
						crewInFieldDocs.length > 0 ||
						crewSentBackDocs.length > 0 ||
						crewSubmittedDocs.length > 0) && (
						<div className="grid gap-4 lg:grid-cols-2">
							{crewPreppedDocs.length > 0 && (
								<QueueCard
									id="queue-pickup"
									title={t("dashboard.ready_for_pickup_heading", {
										count: crewPreppedDocs.length,
									})}
									badge={crewPreppedDocs.length}
									variant="info"
								>
									<div className="space-y-1">
										{crewPreppedDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}/sign`}
												controlNumber={doc.controlNumber}
												meta={
													<>
														<div className="mt-1">
															<Badge variant="info">
																{t("dashboard.ready_for_pickup_badge")}
															</Badge>
														</div>
														<p className="mt-1 truncate text-sm text-muted-foreground">
															{doc.jobType} — {doc.jobAddressEstimated}
														</p>
													</>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
							{crewInFieldDocs.length > 0 && (
								<QueueCard
									id="queue-field"
									title={t("dashboard.in_the_field_heading", {
										count: crewInFieldDocs.length,
									})}
									badge={crewInFieldDocs.length}
									variant="warn"
								>
									<div className="space-y-1">
										{crewInFieldDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}/field`}
												controlNumber={doc.controlNumber}
												meta={
													<>
														<div className="mt-1">
															<Badge variant="warn">
																{t("dashboard.in_the_field_badge")}
															</Badge>
														</div>
														<p className="mt-1 truncate text-sm text-muted-foreground">
															{doc.jobType} — {doc.jobAddressEstimated}
														</p>
													</>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
							{crewSentBackDocs.length > 0 && (
								<QueueCard
									id="queue-sent-back"
									title={t("dashboard.crew_sent_back_heading", {
										count: crewSentBackDocs.length,
									})}
									badge={crewSentBackDocs.length}
									variant="warn"
								>
									<div className="space-y-1">
										{crewSentBackDocs.map((doc) => {
											const latest = latestSendBack(doc)
											return (
												<DocRowLink
													key={doc.id}
													to={`/docs/${doc.id}/field`}
													controlNumber={doc.controlNumber}
													meta={
														<>
															<div className="mt-1">
																<Badge variant="warn">
																	{t("dashboard.sent_back_badge")}
																</Badge>
															</div>
															<p className="mt-1 truncate text-sm text-muted-foreground">
																{doc.jobType} — {doc.jobAddressEstimated}
															</p>
															{latest?.note && (
																<p className="mt-1 text-xs text-muted-foreground">
																	{t("dashboard.sent_back_note", {
																		note: latest.note,
																	})}
																</p>
															)}
														</>
													}
												/>
											)
										})}
									</div>
								</QueueCard>
							)}
							{crewSubmittedDocs.length > 0 && (
								<QueueCard
									id="queue-submitted"
									title={t("dashboard.submitted_heading", {
										count: crewSubmittedDocs.length,
									})}
									badge={crewSubmittedDocs.length}
									variant="info"
								>
									<div className="space-y-1">
										{crewSubmittedDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}`}
												controlNumber={doc.controlNumber}
												meta={
													<>
														<div className="mt-1">
															<Badge variant="info">
																{t("dashboard.submitted_badge")}
															</Badge>
														</div>
														<p className="mt-1 truncate text-sm text-muted-foreground">
															{doc.jobType} — {doc.jobAddressEstimated}
														</p>
													</>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
						</div>
					)}

					<RecentDocumentsTable docs={docs} />
				</div>
			</div>
		</div>
	)
}

export { CrewDashboard }

import {
	Alert02Icon,
	AnalyticsUpIcon,
	Clock01Icon,
	CreditCardIcon,
	DeliveryReturn01Icon,
	File01Icon,
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
	MetricTile,
	MintAlert,
	QueueCard,
	RecentDocumentsTable,
	RoleGreeting,
	type TileTone,
} from "./role-dashboard-chrome"

type RestockRequestRow = {
	id: string
	status: string
	createdAt: Date
	requestedBy: { name: string }
	warehouse: { name: string }
	items: unknown
}

type TileMeta = {
	icon: IconSvgElement
	tone: TileTone
	titleKey:
		| "dashboard.stat_title.pending_preps"
		| "dashboard.stat_title.prepped_awaiting_pickup"
		| "dashboard.stat_title.missing_materials"
		| "dashboard.stat_title.returns_to_log"
		| "dashboard.stat_title.stage_awaiting_warehouse"
		| "dashboard.stat_title.stage_awaiting_crew"
		| "dashboard.stat_title.stage_pending_review"
		| "dashboard.stat_title.stage_in_finance"
		| "dashboard.stat_title.discrepancy_count"
		| "dashboard.stat_title.shortage_count"
		| "dashboard.stat_title.overage_count"
	detailKey:
		| "dashboard.stat_detail.pending_preps"
		| "dashboard.stat_detail.prepped_awaiting_pickup"
		| "dashboard.stat_detail.missing_materials"
		| "dashboard.stat_detail.returns_to_log"
		| "dashboard.stat_detail.stage_awaiting_warehouse"
		| "dashboard.stat_detail.stage_awaiting_crew"
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
	"dashboard.stat.pending_preps": {
		icon: File01Icon,
		tone: "mint",
		titleKey: "dashboard.stat_title.pending_preps",
		detailKey: "dashboard.stat_detail.pending_preps",
	},
	"dashboard.stat.prepped_awaiting_pickup": {
		icon: Clock01Icon,
		tone: "mint",
		titleKey: "dashboard.stat_title.prepped_awaiting_pickup",
		detailKey: "dashboard.stat_detail.prepped_awaiting_pickup",
	},
	"dashboard.stat.missing_materials": {
		icon: PackageIcon,
		tone: "purple",
		titleKey: "dashboard.stat_title.missing_materials",
		detailKey: "dashboard.stat_detail.missing_materials",
	},
	"dashboard.stat.returns_to_log": {
		icon: DeliveryReturn01Icon,
		tone: "coral",
		titleKey: "dashboard.stat_title.returns_to_log",
		detailKey: "dashboard.stat_detail.returns_to_log",
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
		detailKey: "dashboard.stat_detail.stage_awaiting_crew",
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
	firstCreatedId: string | undefined,
): string | undefined {
	if (value <= 0) return undefined
	switch (labelKey) {
		case "dashboard.stat.pending_preps":
		case "dashboard.stat.stage_awaiting_warehouse":
			return firstCreatedId ? `/docs/${firstCreatedId}/prep` : undefined
		case "dashboard.stat.prepped_awaiting_pickup":
			return "#queue-prepped"
		case "dashboard.stat.missing_materials":
			return "#queue-missing"
		case "dashboard.stat.returns_to_log":
			return "#queue-returns"
		default:
			return undefined
	}
}

function WarehouseDashboard({
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
	warehousePreppedDocs = [],
	warehouseMissingDocs = [],
	warehouseReturnsDocs = [],
	restockRequests = [],
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
	warehousePreppedDocs?: DashboardDocRow[]
	warehouseMissingDocs?: DashboardDocRow[]
	warehouseReturnsDocs?: DashboardDocRow[]
	restockRequests?: RestockRequestRow[]
}) {
	const { t } = useTranslation()
	const firstCreated = docs.find((d) => d.status === "CREATED")
	const alertHref =
		alert?.key === "dashboard.alert.awaiting_prep" && firstCreated
			? `/docs/${firstCreated.id}/prep`
			: alert?.key === "dashboard.alert.missing_materials" &&
					warehouseMissingDocs[0]
				? `/docs/${warehouseMissingDocs[0].id}/prep`
				: undefined

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

					{alert && <MintAlert alert={alert} href={alertHref} />}

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
										href={tileHref(stat.labelKey, stat.value, firstCreated?.id)}
									/>
								)
							})}
						</div>
					)}

					{(warehousePreppedDocs.length > 0 ||
						warehouseMissingDocs.length > 0 ||
						warehouseReturnsDocs.length > 0 ||
						restockRequests.length > 0) && (
						<div className="grid gap-4 lg:grid-cols-2">
							{warehousePreppedDocs.length > 0 && (
								<QueueCard
									id="queue-prepped"
									title={t("dashboard.prepped_awaiting_heading", {
										count: warehousePreppedDocs.length,
									})}
									badge={warehousePreppedDocs.length}
									variant="info"
								>
									<div className="space-y-1">
										{warehousePreppedDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}/sign`}
												controlNumber={doc.controlNumber}
												meta={
													<p className="mt-1 truncate text-sm text-muted-foreground">
														{doc.jobType} — {doc.jobAddressEstimated}
													</p>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
							{warehouseMissingDocs.length > 0 && (
								<QueueCard
									id="queue-missing"
									title={t("dashboard.missing_materials_heading", {
										count: warehouseMissingDocs.length,
									})}
									badge={warehouseMissingDocs.length}
									variant="danger"
								>
									<div className="space-y-1">
										{warehouseMissingDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}/prep`}
												controlNumber={doc.controlNumber}
												meta={
													<p className="mt-1 truncate text-sm text-muted-foreground">
														{doc.jobType} — {doc.jobAddressEstimated}
													</p>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
							{warehouseReturnsDocs.length > 0 && (
								<QueueCard
									id="queue-returns"
									title={t("dashboard.returns_to_log_heading", {
										count: warehouseReturnsDocs.length,
									})}
									badge={warehouseReturnsDocs.length}
									variant="warn"
								>
									<div className="space-y-1">
										{warehouseReturnsDocs.map((doc) => (
											<DocRowLink
												key={doc.id}
												to={`/docs/${doc.id}/returns`}
												controlNumber={doc.controlNumber}
												meta={
													<p className="mt-1 truncate text-sm text-muted-foreground">
														{doc.jobType} — {doc.jobAddressEstimated}
													</p>
												}
											/>
										))}
									</div>
								</QueueCard>
							)}
							{restockRequests.length > 0 && (
								<QueueCard
									id="queue-restock"
									title={t("dashboard.restock_requests_heading", {
										count: restockRequests.length,
									})}
									badge={restockRequests.length}
									variant="warn"
								>
									<div className="space-y-1">
										{restockRequests.map((req) => (
											<DocRowLink
												key={req.id}
												to={`/restock/${req.id}/fulfill`}
												controlNumber={`#${req.id.slice(-6)}`}
												meta={
													<>
														<div className="mt-1">
															<Badge variant="warn">
																{t("dashboard.restock_requests_badge")}
															</Badge>
														</div>
														<p className="mt-1 text-xs text-muted-foreground/70">
															{req.requestedBy?.name ?? "Installer"} —{" "}
															{req.warehouse?.name ?? "Warehouse"}
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

export { WarehouseDashboard }

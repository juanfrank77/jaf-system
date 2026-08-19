import type { DocStatus, Role } from "../../generated/prisma/client"

type DashboardDoc = {
	status: DocStatus
	receivableClosedAt: Date | null
	prepChangedSincePrep?: boolean
	materialsReturned?: unknown
}

export type DashboardStatLabelKey =
	| "dashboard.stat.open_documents"
	| "dashboard.stat.awaiting_warehouse"
	| "dashboard.stat.awaiting_crew"
	| "dashboard.stat.pending_review"
	| "dashboard.stat.pending_preps"
	| "dashboard.stat.prepped_awaiting_pickup"
	| "dashboard.stat.missing_materials"
	| "dashboard.stat.returns_to_log"
	| "dashboard.stat.restock_requests"
	| "dashboard.stat.open_jobs"
	| "dashboard.stat.awaiting_close"
	| "dashboard.stat.ready_for_pickup"
	| "dashboard.stat.in_the_field"
	| "dashboard.stat.sent_back"
	| "dashboard.stat.submitted"
	| "dashboard.stat.total_documents"
	| "dashboard.stat.open_receivables"
	| "dashboard.stat.awaiting_claro_upload"

export type DashboardAlertKey =
	| "dashboard.alert.awaiting_warehouse"
	| "dashboard.alert.pending_review"
	| "dashboard.alert.awaiting_prep"
	| "dashboard.alert.missing_materials"
	| "dashboard.alert.ready_to_close"
	| "dashboard.alert.ready_for_pickup"
	| "dashboard.alert.jobs_in_field"
	| "dashboard.alert.sent_back"
	| "dashboard.alert.submitted"
	| "dashboard.alert.receivables_open"

export type DashboardStat = { labelKey: DashboardStatLabelKey; value: number }

export type DashboardAlert = {
	variant: "info" | "warn"
	key: DashboardAlertKey
	count: number
} | null

const RECEIVABLE_STATUSES: DocStatus[] = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
]

function count(docs: DashboardDoc[], pred: (d: DashboardDoc) => boolean) {
	return docs.filter(pred).length
}

export function computeDashboardStats(
	role: Role,
	docs: DashboardDoc[],
): { stats: DashboardStat[]; alert: DashboardAlert } {
	if (role === "SUPERVISOR") {
		const open = count(
			docs,
			(d) => d.status !== "LC_REQUEST_GENERATED" && d.status !== "CANCELLED",
		)
		const awaitingWarehouse = count(docs, (d) => d.status === "CREATED")
		const awaitingCrew = count(
			docs,
			(d) => d.status === "PREPPED" || d.status === "SIGNED",
		)
		const pendingReview = count(docs, (d) => d.status === "FIELD_UPDATED")
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_documents", value: open },
				{
					labelKey: "dashboard.stat.awaiting_warehouse",
					value: awaitingWarehouse,
				},
				{ labelKey: "dashboard.stat.awaiting_crew", value: awaitingCrew },
				{ labelKey: "dashboard.stat.pending_review", value: pendingReview },
			],
			alert:
				pendingReview > 0
					? {
							variant: "warn",
							key: "dashboard.alert.pending_review",
							count: pendingReview,
						}
					: awaitingWarehouse > 0
						? {
								variant: "info",
								key: "dashboard.alert.awaiting_warehouse",
								count: awaitingWarehouse,
							}
						: null,
		}
	}

	if (role === "WAREHOUSE") {
		const pendingPreps = count(docs, (d) => d.status === "CREATED")
		const preppedAwaiting = count(docs, (d) => d.status === "PREPPED")
		const missingMaterials = count(
			docs,
			(d) => d.status === "CREATED" && (d as any).prepChangedSincePrep,
		)
		const returnsToLog = count(
			docs,
			(d) =>
				(d.status === "SIGNED" || d.status === "FIELD_UPDATED") &&
				(d as any).materialsReturned === null,
		)
		return {
			stats: [
				{ labelKey: "dashboard.stat.pending_preps", value: pendingPreps },
				{
					labelKey: "dashboard.stat.prepped_awaiting_pickup",
					value: preppedAwaiting,
				},
				{
					labelKey: "dashboard.stat.missing_materials",
					value: missingMaterials,
				},
				{
					labelKey: "dashboard.stat.returns_to_log",
					value: returnsToLog,
				},
			],
			alert:
				pendingPreps > 0
					? {
							variant: "warn",
							key: "dashboard.alert.awaiting_prep",
							count: pendingPreps,
						}
					: missingMaterials > 0
						? {
								variant: "warn",
								key: "dashboard.alert.missing_materials",
								count: missingMaterials,
							}
						: null,
		}
	}

	if (role === "CREW") {
		const openJobs = count(
			docs,
			(d) => d.status !== "LC_REQUEST_GENERATED" && d.status !== "CANCELLED",
		)
		const readyForPickup = count(docs, (d) => d.status === "PREPPED")
		const inTheField = count(
			docs,
			(d) =>
				d.status === "SIGNED" &&
				(!Array.isArray((d as any).sendBackHistory) ||
					(Array.isArray((d as any).sendBackHistory) &&
						(d as any).sendBackHistory.length === 0)),
		)
		const sendBackHistory = (d: DashboardDoc) =>
			Array.isArray((d as any).sendBackHistory)
				? ((d as any).sendBackHistory as unknown[])
				: []
		const sentBack = count(
			docs,
			(d) => d.status === "SIGNED" && sendBackHistory(d).length > 0,
		)
		const submitted = count(docs, (d) => d.status === "FIELD_UPDATED")
		const awaitingClose = inTheField + sentBack + submitted
		const alert =
			sentBack > 0
				? {
						variant: "warn" as const,
						key: "dashboard.alert.sent_back" as const,
						count: sentBack,
					}
				: submitted > 0
					? {
							variant: "info" as const,
							key: "dashboard.alert.submitted" as const,
							count: submitted,
						}
					: readyForPickup > 0
						? {
								variant: "info" as const,
								key: "dashboard.alert.ready_for_pickup" as const,
								count: readyForPickup,
							}
						: inTheField > 0
							? {
									variant: "warn" as const,
									key: "dashboard.alert.jobs_in_field" as const,
									count: inTheField,
								}
							: null
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_jobs", value: openJobs },
				{ labelKey: "dashboard.stat.ready_for_pickup", value: readyForPickup },
				{ labelKey: "dashboard.stat.in_the_field", value: inTheField },
				{ labelKey: "dashboard.stat.sent_back", value: sentBack },
				{ labelKey: "dashboard.stat.submitted", value: submitted },
			],
			alert,
		}
	}

	// FINANCE and ADMIN share the same view
	const totalDocs = docs.length
	const openReceivables = count(
		docs,
		(d) => RECEIVABLE_STATUSES.includes(d.status) && !d.receivableClosedAt,
	)
	const awaitingClaroUpload = count(
		docs,
		(d) => d.status === "SUPERVISOR_APPROVED",
	)
	return {
		stats: [
			{ labelKey: "dashboard.stat.total_documents", value: totalDocs },
			{
				labelKey: "dashboard.stat.open_receivables",
				value: openReceivables,
			},
			{
				labelKey: "dashboard.stat.awaiting_claro_upload",
				value: awaitingClaroUpload,
			},
		],
		alert:
			openReceivables > 0
				? {
						variant: "info",
						key: "dashboard.alert.receivables_open",
						count: openReceivables,
					}
				: null,
	}
}

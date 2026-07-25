import type { DocStatus, Role } from "../../generated/prisma/client"

export type DashboardDoc = {
	status: DocStatus
	receivableClosedAt: Date | null
}

export type DashboardStatLabelKey =
	| "dashboard.stat.open_documents"
	| "dashboard.stat.awaiting_warehouse"
	| "dashboard.stat.awaiting_crew"
	| "dashboard.stat.pending_preps"
	| "dashboard.stat.open_jobs"
	| "dashboard.stat.awaiting_close"
	| "dashboard.stat.total_documents"
	| "dashboard.stat.open_receivables"
	| "dashboard.stat.awaiting_claro_upload"

export type DashboardAlertKey =
	| "dashboard.alert.awaiting_warehouse"
	| "dashboard.alert.awaiting_prep"
	| "dashboard.alert.ready_to_close"
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
	"LC_GENERATED",
]

function count(docs: DashboardDoc[], pred: (d: DashboardDoc) => boolean) {
	return docs.filter(pred).length
}

export function computeDashboardStats(
	role: Role,
	docs: DashboardDoc[],
): { stats: DashboardStat[]; alert: DashboardAlert } {
	if (role === "SUPERVISOR") {
		const open = count(docs, (d) => d.status !== "LC_GENERATED")
		const awaitingWarehouse = count(docs, (d) => d.status === "CREATED")
		const awaitingCrew = count(
			docs,
			(d) => d.status === "PREPPED" || d.status === "SIGNED",
		)
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_documents", value: open },
				{
					labelKey: "dashboard.stat.awaiting_warehouse",
					value: awaitingWarehouse,
				},
				{ labelKey: "dashboard.stat.awaiting_crew", value: awaitingCrew },
			],
			alert:
				awaitingWarehouse > 0
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
		return {
			stats: [
				{ labelKey: "dashboard.stat.pending_preps", value: pendingPreps },
			],
			alert:
				pendingPreps > 0
					? {
							variant: "warn",
							key: "dashboard.alert.awaiting_prep",
							count: pendingPreps,
						}
					: null,
		}
	}

	if (role === "CREW") {
		const openJobs = count(docs, (d) => d.status !== "LC_GENERATED")
		const awaitingClose = count(
			docs,
			(d) => d.status === "SIGNED" || d.status === "FIELD_UPDATED",
		)
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_jobs", value: openJobs },
				{ labelKey: "dashboard.stat.awaiting_close", value: awaitingClose },
			],
			alert:
				awaitingClose > 0
					? {
							variant: "warn",
							key: "dashboard.alert.ready_to_close",
							count: awaitingClose,
						}
					: null,
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

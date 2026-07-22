import type { DocStatus, Role } from "../../generated/prisma/client"

export type DashboardDoc = {
	status: DocStatus
	receivableClosedAt: Date | null
}

export type DashboardStat = { label: string; value: number }

export type DashboardAlert = {
	variant: "info" | "warn"
	message: string
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
				{ label: "Open documents", value: open },
				{ label: "Awaiting warehouse", value: awaitingWarehouse },
				{ label: "Awaiting crew", value: awaitingCrew },
			],
			alert:
				awaitingWarehouse > 0
					? {
							variant: "info",
							message: `${awaitingWarehouse} document${awaitingWarehouse === 1 ? "" : "s"} awaiting warehouse`,
						}
					: null,
		}
	}

	if (role === "WAREHOUSE") {
		const pendingPreps = count(docs, (d) => d.status === "CREATED")
		return {
			stats: [{ label: "Pending preps", value: pendingPreps }],
			alert:
				pendingPreps > 0
					? {
							variant: "warn",
							message: `${pendingPreps} document${pendingPreps === 1 ? "" : "s"} waiting on your prep`,
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
				{ label: "Open jobs", value: openJobs },
				{ label: "Awaiting close", value: awaitingClose },
			],
			alert:
				awaitingClose > 0
					? {
							variant: "warn",
							message: `${awaitingClose} job${awaitingClose === 1 ? "" : "s"} ready to close`,
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
			{ label: "Total documents", value: totalDocs },
			{ label: "Open receivables", value: openReceivables },
			{ label: "Awaiting Claro upload", value: awaitingClaroUpload },
		],
		alert:
			openReceivables > 0
				? {
						variant: "info",
						message: `${openReceivables} receivable${openReceivables === 1 ? "" : "s"} open`,
					}
				: null,
	}
}

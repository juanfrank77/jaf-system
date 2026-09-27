import type { DocStatus, Role } from "../../generated/prisma/client"

type MaterialLine = { serviceCodeId: string; qty: number }

type DashboardDoc = {
	status: DocStatus
	createdAt: Date
	receivableClosedAt: Date | null
	prepChangedSincePrep?: boolean
	materialsReturned?: unknown
	sendBackHistory?: unknown
	estimatedMaterials?: unknown
	materialsTaken?: unknown
	materialsUsed?: unknown
	avisoNumber?: string | null
	claroUploadedAt?: Date | null
	pbccRequestSentAt?: Date | null
	lcGeneratedAt?: Date | null
	advanceReceivedAt?: Date | null
	finalPaymentReceivedAt?: Date | null
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
	| "dashboard.stat.stage_awaiting_warehouse"
	| "dashboard.stat.stage_awaiting_crew"
	| "dashboard.stat.stage_pending_review"
	| "dashboard.stat.stage_in_finance"
	| "dashboard.stat.discrepancy_count"
	| "dashboard.stat.shortage_count"
	| "dashboard.stat.overage_count"
	| "dashboard.stat.aging_oldest_days"
	| "dashboard.stat.aging_po_wait_count"
	| "dashboard.stat.aging_claro_wait_count"

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

export type DashboardExplainerKey =
	| "dashboard.explainer.supervisor_needs_review"
	| "dashboard.explainer.supervisor_awaiting_warehouse"
	| "dashboard.explainer.supervisor_no_actions"
	| "dashboard.explainer.warehouse_needs_prep"
	| "dashboard.explainer.warehouse_missing_materials"
	| "dashboard.explainer.warehouse_no_actions"
	| "dashboard.explainer.crew_sent_back"
	| "dashboard.explainer.crew_awaiting_review"
	| "dashboard.explainer.crew_ready_for_pickup"
	| "dashboard.explainer.crew_in_field"
	| "dashboard.explainer.crew_no_actions"
	| "dashboard.explainer.finance_open_receivables"
	| "dashboard.explainer.finance_awaiting_claro"
	| "dashboard.explainer.finance_no_actions"
	| "dashboard.explainer.finance_aging_alert"
	| "dashboard.explainer.installer_awaiting_warehouse"
	| "dashboard.explainer.installer_awaiting_pickup"
	| "dashboard.explainer.installer_no_actions"

export type DashboardExplainer = {
	labelKey: DashboardExplainerKey
} | null

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

const RECEIVABLE_STATUSES: DocStatus[] = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
]

function count(docs: DashboardDoc[], pred: (d: DashboardDoc) => boolean) {
	return docs.filter(pred).length
}

function computeAgingDays(createdAt: Date): number {
	const now = new Date()
	const diffMs = now.getTime() - createdAt.getTime()
	return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

const PO_WAIT_THRESHOLD_DAYS = 180
const CLARO_WAIT_THRESHOLD_DAYS = 180

type AgingBucket = {
	oldestDays: number
	poWaitCount: number
	claroWaitCount: number
	anyThresholdBreached: boolean
}

function computeAgingBuckets(docs: DashboardDoc[]): AgingBucket {
	let oldestDays = 0
	let poWaitCount = 0
	let claroWaitCount = 0
	for (const doc of docs) {
		// PO wait: Claro uploaded but not yet PBCC advance received.
		if (doc.status === "CLARO_UPLOADED" && doc.claroUploadedAt) {
			const days = computeAgingDays(doc.claroUploadedAt)
			oldestDays = Math.max(oldestDays, days)
			if (days > PO_WAIT_THRESHOLD_DAYS) poWaitCount++
		}
		// Claro final wait: advance received but not yet final payment.
		if (doc.advanceReceivedAt && !doc.finalPaymentReceivedAt) {
			const days = computeAgingDays(doc.advanceReceivedAt)
			oldestDays = Math.max(oldestDays, days)
			if (days > CLARO_WAIT_THRESHOLD_DAYS) claroWaitCount++
		}
	}
	return {
		oldestDays,
		poWaitCount,
		claroWaitCount,
		anyThresholdBreached: poWaitCount + claroWaitCount > 0,
	}
}

export function computeMaterialSignals(docs: DashboardDoc[]) {
	let discrepancy = 0
	let shortage = 0
	let overage = 0
	for (const doc of docs) {
		const estimated = toLines(doc.estimatedMaterials)
		const taken = toLines(doc.materialsTaken)
		const used = toLines(doc.materialsUsed)
		const returned = Array.isArray(doc.materialsReturned)
			? (doc.materialsReturned as Record<string, unknown>[])
			: []

		if (estimated.length && taken.length) {
			const estimatedMap = Object.fromEntries(
				estimated.map((e) => [e.serviceCodeId, e.qty]),
			)
			if (taken.some((t) => t.qty > (estimatedMap[t.serviceCodeId] ?? 0))) {
				overage++
			}
		}
		if (taken.length && used.length) {
			const takenMap = Object.fromEntries(
				taken.map((t) => [t.serviceCodeId, t.qty]),
			)
			const usedMap = Object.fromEntries(
				used.map((u) => [u.serviceCodeId, u.qty]),
			)
			const allIds = new Set([
				...Object.keys(takenMap),
				...Object.keys(usedMap),
			])
			for (const id of allIds) {
				if ((takenMap[id] ?? 0) !== (usedMap[id] ?? 0)) {
					discrepancy++
					break
				}
			}
		}
		for (const line of returned) {
			const record = line as Record<string, unknown>
			if (
				typeof record.returnedQty === "number" &&
				typeof record.takenQty === "number" &&
				record.returnedQty < record.takenQty
			) {
				shortage++
				break
			}
		}
	}
	return { discrepancy, shortage, overage }
}

export function computeDashboardStats(
	role: Role,
	docs: DashboardDoc[],
): {
	stats: DashboardStat[]
	alert: DashboardAlert
	explainer: DashboardExplainer
} {
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
		const { discrepancy, shortage, overage } = computeMaterialSignals(docs)
		const aging = computeAgingBuckets(docs)
		const oldestOpenDays = docs.reduce(
			(max, d) => Math.max(max, computeAgingDays(d.createdAt)),
			0,
		)
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_documents", value: open },
				{
					labelKey: "dashboard.stat.awaiting_warehouse",
					value: awaitingWarehouse,
				},
				{ labelKey: "dashboard.stat.awaiting_crew", value: awaitingCrew },
				{ labelKey: "dashboard.stat.pending_review", value: pendingReview },
				{
					labelKey: "dashboard.stat.stage_awaiting_warehouse",
					value: awaitingWarehouse,
				},
				{ labelKey: "dashboard.stat.stage_awaiting_crew", value: awaitingCrew },
				{
					labelKey: "dashboard.stat.stage_pending_review",
					value: pendingReview,
				},
				{ labelKey: "dashboard.stat.stage_in_finance", value: 0 },
				{ labelKey: "dashboard.stat.discrepancy_count", value: discrepancy },
				{ labelKey: "dashboard.stat.shortage_count", value: shortage },
				{ labelKey: "dashboard.stat.overage_count", value: overage },
				{ labelKey: "dashboard.stat.aging_oldest_days", value: oldestOpenDays },
				{
					labelKey: "dashboard.stat.aging_po_wait_count",
					value: aging.poWaitCount,
				},
				{ labelKey: "dashboard.stat.aging_claro_wait_count", value: 0 },
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
			explainer:
				pendingReview > 0
					? { labelKey: "dashboard.explainer.supervisor_needs_review" }
					: awaitingWarehouse > 0
						? { labelKey: "dashboard.explainer.supervisor_awaiting_warehouse" }
						: { labelKey: "dashboard.explainer.supervisor_no_actions" },
		}
	}

	if (role === "WAREHOUSE") {
		const pendingPreps = count(docs, (d) => d.status === "CREATED")
		const preppedAwaiting = count(docs, (d) => d.status === "PREPPED")
		const missingMaterials = count(
			docs,
			(d) => d.status === "CREATED" && !!d.prepChangedSincePrep,
		)
		const returnsToLog = count(
			docs,
			(d) =>
				(d.status === "SIGNED" || d.status === "FIELD_UPDATED") &&
				d.materialsReturned === null,
		)
		const { discrepancy, shortage, overage } = computeMaterialSignals(docs)
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
				{
					labelKey: "dashboard.stat.stage_awaiting_warehouse",
					value: pendingPreps,
				},
				{ labelKey: "dashboard.stat.stage_awaiting_crew", value: 0 },
				{ labelKey: "dashboard.stat.stage_pending_review", value: 0 },
				{ labelKey: "dashboard.stat.stage_in_finance", value: 0 },
				{ labelKey: "dashboard.stat.discrepancy_count", value: discrepancy },
				{ labelKey: "dashboard.stat.shortage_count", value: shortage },
				{ labelKey: "dashboard.stat.overage_count", value: overage },
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
			explainer:
				pendingPreps > 0
					? { labelKey: "dashboard.explainer.warehouse_needs_prep" }
					: missingMaterials > 0
						? { labelKey: "dashboard.explainer.warehouse_missing_materials" }
						: { labelKey: "dashboard.explainer.warehouse_no_actions" },
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
				(!Array.isArray(d.sendBackHistory) ||
					(Array.isArray(d.sendBackHistory) && d.sendBackHistory.length === 0)),
		)
		const sendBackHistory = (d: DashboardDoc): unknown[] =>
			Array.isArray(d.sendBackHistory) ? d.sendBackHistory : []
		const sentBack = count(
			docs,
			(d) => d.status === "SIGNED" && sendBackHistory(d).length > 0,
		)
		const submitted = count(docs, (d) => d.status === "FIELD_UPDATED")
		const { discrepancy, shortage, overage } = computeMaterialSignals(docs)
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
				{ labelKey: "dashboard.stat.stage_awaiting_warehouse", value: 0 },
				{
					labelKey: "dashboard.stat.stage_awaiting_crew",
					value: readyForPickup,
				},
				{ labelKey: "dashboard.stat.stage_pending_review", value: 0 },
				{ labelKey: "dashboard.stat.stage_in_finance", value: 0 },
				{ labelKey: "dashboard.stat.discrepancy_count", value: discrepancy },
				{ labelKey: "dashboard.stat.shortage_count", value: shortage },
				{ labelKey: "dashboard.stat.overage_count", value: overage },
			],
			alert,
			explainer:
				sentBack > 0
					? { labelKey: "dashboard.explainer.crew_sent_back" }
					: submitted > 0
						? { labelKey: "dashboard.explainer.crew_awaiting_review" }
						: readyForPickup > 0
							? { labelKey: "dashboard.explainer.crew_ready_for_pickup" }
							: inTheField > 0
								? { labelKey: "dashboard.explainer.crew_in_field" }
								: { labelKey: "dashboard.explainer.crew_no_actions" },
		}
	}

	if (role === "INSTALLER") {
		// Installers don't drive brigade workflow statuses; the only statuses
		// that ever appear on their dashboard are those that belong to a job
		// they have a stake in. In practice their dashboard is fed by
		// restock + install queues, so we surface the next relevant signal.
		const readyForPickup = count(docs, (d) => d.status === "PREPPED")
		const open = count(
			docs,
			(d) => d.status !== "LC_REQUEST_GENERATED" && d.status !== "CANCELLED",
		)
		return {
			stats: [
				{ labelKey: "dashboard.stat.open_jobs", value: open },
				{ labelKey: "dashboard.stat.ready_for_pickup", value: readyForPickup },
				{ labelKey: "dashboard.stat.stage_awaiting_warehouse", value: 0 },
				{ labelKey: "dashboard.stat.stage_awaiting_crew", value: 0 },
				{ labelKey: "dashboard.stat.stage_pending_review", value: 0 },
				{ labelKey: "dashboard.stat.stage_in_finance", value: 0 },
				{ labelKey: "dashboard.stat.discrepancy_count", value: 0 },
				{ labelKey: "dashboard.stat.shortage_count", value: 0 },
				{ labelKey: "dashboard.stat.overage_count", value: 0 },
			],
			alert:
				readyForPickup > 0
					? {
							variant: "info",
							key: "dashboard.alert.ready_for_pickup",
							count: readyForPickup,
						}
					: null,
			explainer:
				readyForPickup > 0
					? { labelKey: "dashboard.explainer.installer_awaiting_pickup" }
					: open > 0
						? { labelKey: "dashboard.explainer.installer_awaiting_warehouse" }
						: { labelKey: "dashboard.explainer.installer_no_actions" },
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
	const stageAwaitingWarehouse = count(docs, (d) => d.status === "CREATED")
	const stageAwaitingCrew = count(
		docs,
		(d) => d.status === "PREPPED" || d.status === "SIGNED",
	)
	const stagePendingReview = count(docs, (d) => d.status === "FIELD_UPDATED")
	const stageInFinance = count(
		docs,
		(d) =>
			d.status === "SUPERVISOR_APPROVED" ||
			d.status === "CLARO_UPLOADED" ||
			d.status === "LC_REQUEST_GENERATED",
	)
	const { discrepancy, shortage, overage } = computeMaterialSignals(docs)
	const aging = computeAgingBuckets(docs)
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
			{
				labelKey: "dashboard.stat.stage_awaiting_warehouse",
				value: stageAwaitingWarehouse,
			},
			{
				labelKey: "dashboard.stat.stage_awaiting_crew",
				value: stageAwaitingCrew,
			},
			{
				labelKey: "dashboard.stat.stage_pending_review",
				value: stagePendingReview,
			},
			{ labelKey: "dashboard.stat.stage_in_finance", value: stageInFinance },
			{ labelKey: "dashboard.stat.discrepancy_count", value: discrepancy },
			{ labelKey: "dashboard.stat.shortage_count", value: shortage },
			{ labelKey: "dashboard.stat.overage_count", value: overage },
			{ labelKey: "dashboard.stat.aging_oldest_days", value: aging.oldestDays },
			{
				labelKey: "dashboard.stat.aging_po_wait_count",
				value: aging.poWaitCount,
			},
			{
				labelKey: "dashboard.stat.aging_claro_wait_count",
				value: aging.claroWaitCount,
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
		explainer: aging.anyThresholdBreached
			? { labelKey: "dashboard.explainer.finance_aging_alert" }
			: openReceivables > 0
				? { labelKey: "dashboard.explainer.finance_open_receivables" }
				: awaitingClaroUpload > 0
					? { labelKey: "dashboard.explainer.finance_awaiting_claro" }
					: { labelKey: "dashboard.explainer.finance_no_actions" },
	}
}

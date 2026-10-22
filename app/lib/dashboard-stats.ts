import type { DocStatus, Role } from "../../generated/prisma/client"
import { type AvisoDiscrepancy, isDiscrepancyStale } from "./aviso-discrepancy"

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
	fieldMaterials?: unknown
	avisoNumber?: string | null
	claroUploadedAt?: Date | null
	pbccRequestSentAt?: Date | null
	lcGeneratedAt?: Date | null
	advanceReceivedAt?: Date | null
	finalPaymentReceivedAt?: Date | null
}

export type DashboardStatLabelKey =
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
	| "dashboard.stat.total_documents"
	| "dashboard.stat.open_receivables"
	| "dashboard.stat.awaiting_claro_upload"
	| "dashboard.stat.missing_aviso"
	| "dashboard.stat.stage_awaiting_warehouse"
	| "dashboard.stat.stage_awaiting_crew"
	| "dashboard.stat.stage_pending_review"
	| "dashboard.stat.stage_in_finance"
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
	| "dashboard.alert.receivables_open"
	| "dashboard.alert.stale_aviso_discrepancy"

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

const PICKUP_AGING_THRESHOLD_DAYS = 3

/**
 * Awaiting-pickup aging (spec §6): days staged since prep, red past 3.
 *
 * Generic over the row so the dashboard loader can pipe its real PREPPED doc
 * rows straight through without losing any field the view needs — the whole
 * point of the wiring: a pure-function unit test alone passed happily while
 * nothing in the app ever called this, so `doc.aged` was always undefined and
 * the badge could never render.
 *
 * `preppedAt` is nullable in the schema; a doc with no prep timestamp simply
 * has no age (never flagged) rather than being dropped from the queue.
 */
export function computeAwaitingPickup<T extends { preppedAt: Date | null }>(
	docs: T[],
): Array<T & { daysStaged: number; aged: boolean }> {
	return docs.map((doc) => {
		const daysStaged = doc.preppedAt ? computeAgingDays(doc.preppedAt) : 0
		return {
			...doc,
			daysStaged,
			aged: daysStaged > PICKUP_AGING_THRESHOLD_DAYS,
		}
	})
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

export function computeMaterialSignals(
	docs: Pick<
		DashboardDoc,
		"estimatedMaterials" | "materialsTaken" | "materialsReturned"
	>[],
) {
	let shortage = 0
	let overage = 0
	for (const doc of docs) {
		const estimated = toLines(doc.estimatedMaterials)
		const taken = toLines(doc.materialsTaken)
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
	return { shortage, overage }
}

export function computeDashboardStats(
	role: Role,
	docs: DashboardDoc[],
	/**
	 * The `avisoDiscrepancy` of every live (not cancelled), unreleased job, for
	 * the admin's "needs attention" alert on stale ones.
	 */
	extra: { avisoDiscrepancies?: (AvisoDiscrepancy | null)[]; now?: Date } = {},
): {
	stats: DashboardStat[]
	alert: DashboardAlert
	explainer: DashboardExplainer
} {
	if (role === "SUPERVISOR") {
		const awaitingWarehouse = count(docs, (d) => d.status === "CREATED")
		const awaitingCrew = count(
			docs,
			(d) => d.status === "PREPPED" || d.status === "SIGNED",
		)
		const pendingReview = count(docs, (d) => d.status === "FIELD_UPDATED")
		const { shortage, overage } = computeMaterialSignals(docs)
		const aging = computeAgingBuckets(docs)
		const oldestOpenDays = docs.reduce(
			(max, d) => Math.max(max, computeAgingDays(d.createdAt)),
			0,
		)
		return {
			stats: [
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
		return {
			// Mockup v3 dashboard: exactly the four queues the counter works from.
			stats: [
				{ labelKey: "dashboard.stat.pending_preps", value: pendingPreps },
				{
					labelKey: "dashboard.stat.prepped_awaiting_pickup",
					value: preppedAwaiting,
				},
				{ labelKey: "dashboard.stat.returns_to_log", value: returnsToLog },
				{
					labelKey: "dashboard.stat.missing_materials",
					value: missingMaterials,
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
			explainer:
				pendingPreps > 0
					? { labelKey: "dashboard.explainer.warehouse_needs_prep" }
					: missingMaterials > 0
						? { labelKey: "dashboard.explainer.warehouse_missing_materials" }
						: { labelKey: "dashboard.explainer.warehouse_no_actions" },
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
	const { shortage, overage } = computeMaterialSignals(docs)
	const aging = computeAgingBuckets(docs)
	const now = extra.now ?? new Date()
	const staleDiscrepancies =
		role === "ADMIN"
			? (extra.avisoDiscrepancies ?? []).filter((d) =>
					isDiscrepancyStale(d, now),
				).length
			: 0
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
			staleDiscrepancies > 0
				? {
						variant: "warn",
						key: "dashboard.alert.stale_aviso_discrepancy",
						count: staleDiscrepancies,
					}
				: openReceivables > 0
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

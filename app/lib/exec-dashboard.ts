import type { DocStatus } from "../../generated/prisma/client"
import type { FinanceStage } from "./finance-pipeline"

/**
 * Executive dashboard metrics (the "command center" view).
 *
 * Pure: takes already-shaped rows and returns the numbers the dashboard
 * renders. The server loader in exec-dashboard.server.ts does the queries
 * and the money normalisation, so this file stays testable without a DB.
 */

export type ExecInvoiceInput = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	status: DocStatus
	createdAt: Date
	supervisorApprovedAt: Date | null
	claroPdfPath: string | null
	receivableClosedAt: Date | null
	/** JAF invoice amount: jafInvoiceLineTotal when generated, else materials × price + IVU. */
	amount: number
	avisoLineTotal: number | null
	avisoMatchedAt: Date | null
	/** Amounts of every Claro PO linked to this job. */
	poAmounts: number[]
	/** Date the brigade was paid (CREW_PAYMENT record). */
	crewPaidAt: Date | null
	stage: FinanceStage | null
	/** Days spent in the current finance stage. */
	stageDays: number
	brigadeName: string | null
}

export type ExecFieldJobInput = { supervisorName: string | null }

export type ExecRestockInput = { status: string; warehouseName: string }

export type ExecDashboardInput = {
	invoices: ExecInvoiceInput[]
	/** Jobs that are out with a crew right now (SIGNED / FIELD_UPDATED). */
	fieldJobs: ExecFieldJobInput[]
	/** Jobs created this year that carry an Aviso number. */
	avisoJobs: { createdAt: Date }[]
	installersTotal: number
	installersOnRoadToday: number
	brigadeAreas: (string | null)[]
	restockRequests: ExecRestockInput[]
	tolerance: number
	agingAlertDays: number
}

export type ExecMonthPoint = {
	/** 0-based month index. */
	month: number
	sold: number
	po: number
	avisos: number
}

export type ExecNamedCount = { name: string; count: number }

export type ExecAttentionKind =
	| "po_short"
	| "aging"
	| "aviso_mismatch"
	| "missing_aviso"
	| "missing_claro_pdf"
	| "restock_approval"

export type ExecAttentionItem = {
	id: string
	kind: ExecAttentionKind
	level: "critical" | "watch"
	href: string
	params: Record<string, string | number>
}

export type ExecCollectionRow = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	brigadePaidAt: Date | null
	sold: number
	po: number
	balance: number
	stage: FinanceStage | null
	problem: "no_po" | "po_short"
	daysOut: number
}

export type ExecDashboardData = {
	year: number
	money: {
		sold: number
		poReceived: number
		open: number
		/** Share of this year's sales still open, 0-100. */
		openPct: number
	}
	months: ExecMonthPoint[]
	avisos: {
		count: number
		noPo: number
		noPoPct: number
		receivablesOpen: number
	}
	field: {
		inField: number
		bySupervisor: ExecNamedCount[]
		installersTotal: number
		installersOnRoad: number
		paidThisWeek: number
		brigadesActive: number
		brigadesByArea: ExecNamedCount[]
	}
	warehouse: {
		requested: number
		pendingApproval: number
		approved: number
		ready: number
		byWarehouse: ExecNamedCount[]
	}
	attention: ExecAttentionItem[]
	shortPoCount: number
	collections: ExecCollectionRow[]
}

const DAY_MS = 86_400_000

export const ATTENTION_VISIBLE = 5
export const COLLECTIONS_VISIBLE = 8

function sum(values: number[]): number {
	return values.reduce((acc, v) => acc + v, 0)
}

function daysBetween(from: Date, to: Date): number {
	return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS))
}

/** Start of the current week (Monday 00:00 local). */
function startOfWeek(now: Date): Date {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const day = d.getDay() // 0 Sunday
	const diff = day === 0 ? 6 : day - 1
	d.setDate(d.getDate() - diff)
	return d
}

/** The month a job is attributed to: when the brigade was paid, else approval, else creation. */
function attributionDate(inv: ExecInvoiceInput): Date {
	return inv.crewPaidAt ?? inv.supervisorApprovedAt ?? inv.createdAt
}

function countBy(names: (string | null | undefined)[], fallback: string) {
	const map = new Map<string, number>()
	for (const n of names) {
		const key = n?.trim() ? n : fallback
		map.set(key, (map.get(key) ?? 0) + 1)
	}
	return [...map.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => {
			if (a.name === fallback) return 1
			if (b.name === fallback) return -1
			return b.count - a.count || a.name.localeCompare(b.name)
		})
}

export function formatCompactMoney(amount: number): string {
	const abs = Math.abs(amount)
	const sign = amount < 0 ? "-" : ""
	if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
	if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`
	if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}K`
	return `${sign}$${Math.round(abs)}`
}

export function formatAmount(amount: number): string {
	return amount.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

export function computeExecDashboard(
	input: ExecDashboardInput,
	now: Date = new Date(),
): ExecDashboardData {
	const year = now.getFullYear()
	const currentMonth = now.getMonth()

	const thisYear = input.invoices.filter(
		(inv) => attributionDate(inv).getFullYear() === year,
	)

	// Money: sold vs POs received on this year's approved work.
	const sold = sum(thisYear.map((inv) => inv.amount))
	const poReceived = sum(thisYear.map((inv) => sum(inv.poAmounts)))
	const open = Math.max(0, sold - poReceived)
	const openPct = sold > 0 ? Math.round((open / sold) * 100) : 0

	// Monthly series, January through the current month.
	const months: ExecMonthPoint[] = Array.from(
		{ length: currentMonth + 1 },
		(_, month) => ({ month, sold: 0, po: 0, avisos: 0 }),
	)
	for (const inv of thisYear) {
		const m = attributionDate(inv).getMonth()
		const point = months[m]
		if (!point) continue
		point.sold += inv.amount
		point.po += sum(inv.poAmounts)
	}
	for (const job of input.avisoJobs) {
		if (job.createdAt.getFullYear() !== year) continue
		const point = months[job.createdAt.getMonth()]
		if (point) point.avisos += 1
	}

	// Open receivables and the PO gap.
	const openReceivables = input.invoices.filter(
		(inv) => !inv.receivableClosedAt,
	)
	const noPo = openReceivables.filter((inv) => inv.poAmounts.length === 0)
	const noPoPct =
		openReceivables.length > 0
			? Math.round((noPo.length / openReceivables.length) * 100)
			: 0

	// Field.
	const weekStart = startOfWeek(now)
	const paidThisWeek = sum(
		input.invoices
			.filter((inv) => inv.crewPaidAt && inv.crewPaidAt >= weekStart)
			.map((inv) => inv.amount),
	)
	const bySupervisor = countBy(
		input.fieldJobs.map((j) => j.supervisorName),
		"—",
	)
	const brigadesByArea = countBy(input.brigadeAreas, "—")

	// Warehouse: restock pipeline.
	const restockCount = (status: string) =>
		input.restockRequests.filter((r) => r.status === status).length
	const byWarehouse = countBy(
		input.restockRequests.map((r) => r.warehouseName),
		"—",
	)

	// Attention list: only things that need a decision.
	const attention: ExecAttentionItem[] = []
	const collections: ExecCollectionRow[] = []
	let shortPoCount = 0

	for (const inv of openReceivables) {
		const po = sum(inv.poAmounts)
		const hasPo = inv.poAmounts.length > 0
		const diff = inv.amount - po
		const paidAt = inv.crewPaidAt
		const daysOut = daysBetween(attributionDate(inv), now)

		if (hasPo && diff > input.tolerance) {
			shortPoCount += 1
			attention.push({
				id: `po_short:${inv.id}`,
				kind: "po_short",
				level: "critical",
				href: `/docs/${inv.id}`,
				params: {
					aviso: inv.avisoNumber ?? inv.controlNumber,
					diff: formatAmount(diff),
					sold: formatAmount(inv.amount),
					po: formatAmount(po),
				},
			})
			collections.push({
				id: inv.id,
				controlNumber: inv.controlNumber,
				avisoNumber: inv.avisoNumber,
				brigadePaidAt: paidAt,
				sold: inv.amount,
				po,
				balance: po - inv.amount,
				stage: inv.stage,
				problem: "po_short",
				daysOut,
			})
		} else if (!hasPo) {
			collections.push({
				id: inv.id,
				controlNumber: inv.controlNumber,
				avisoNumber: inv.avisoNumber,
				brigadePaidAt: paidAt,
				sold: inv.amount,
				po: 0,
				balance: -inv.amount,
				stage: inv.stage,
				problem: "no_po",
				daysOut,
			})
		}

		if (
			inv.avisoLineTotal != null &&
			!inv.avisoMatchedAt &&
			Math.abs(inv.avisoLineTotal - inv.amount) > input.tolerance
		) {
			attention.push({
				id: `aviso_mismatch:${inv.id}`,
				kind: "aviso_mismatch",
				level: "critical",
				href: `/docs/${inv.id}`,
				params: {
					control: inv.controlNumber,
					invoice: formatAmount(inv.amount),
					aviso: formatAmount(inv.avisoLineTotal),
				},
			})
		}

		const agingStage =
			inv.stage === "WAITING_CLARO_PO" || inv.stage === "IN_CLARO_QUEUE"
		if (agingStage && inv.stageDays > input.agingAlertDays) {
			attention.push({
				id: `aging:${inv.id}`,
				kind: "aging",
				level: inv.stageDays > input.agingAlertDays * 2 ? "critical" : "watch",
				href: `/docs/${inv.id}`,
				params: {
					control: inv.controlNumber,
					days: inv.stageDays,
					threshold: input.agingAlertDays,
					stage: inv.stage ?? "",
				},
			})
		}

		if (!inv.avisoNumber || inv.avisoNumber.trim() === "") {
			attention.push({
				id: `missing_aviso:${inv.id}`,
				kind: "missing_aviso",
				level: "watch",
				href: `/docs/${inv.id}`,
				params: { control: inv.controlNumber },
			})
		} else if (
			inv.status === "SUPERVISOR_APPROVED" &&
			(!inv.claroPdfPath || inv.claroPdfPath.trim() === "")
		) {
			attention.push({
				id: `missing_claro_pdf:${inv.id}`,
				kind: "missing_claro_pdf",
				level: "watch",
				href: `/docs/${inv.id}`,
				params: { control: inv.controlNumber },
			})
		}
	}

	const pendingApproval = restockCount("PENDING_APPROVAL")
	if (pendingApproval > 0) {
		attention.push({
			id: "restock_approval",
			kind: "restock_approval",
			level: "watch",
			href: "/admin/restock",
			params: { count: pendingApproval },
		})
	}

	attention.sort((a, b) => {
		if (a.level !== b.level) return a.level === "critical" ? -1 : 1
		return 0
	})
	collections.sort((a, b) => b.daysOut - a.daysOut)

	return {
		year,
		money: { sold, poReceived, open, openPct },
		months,
		avisos: {
			count: input.avisoJobs.filter((j) => j.createdAt.getFullYear() === year)
				.length,
			noPo: noPo.length,
			noPoPct,
			receivablesOpen: openReceivables.length,
		},
		field: {
			inField: input.fieldJobs.length,
			bySupervisor,
			installersTotal: input.installersTotal,
			installersOnRoad: input.installersOnRoadToday,
			paidThisWeek,
			brigadesActive: input.brigadeAreas.length,
			brigadesByArea,
		},
		warehouse: {
			requested: restockCount("REQUESTED"),
			pendingApproval,
			approved: restockCount("APPROVED"),
			ready: restockCount("READY"),
			byWarehouse,
		},
		attention,
		shortPoCount,
		collections,
	}
}

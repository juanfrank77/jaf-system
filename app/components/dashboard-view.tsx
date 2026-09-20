import {
	ChevronRightIcon,
	FilterIcon,
	RemoveIcon,
	SearchIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import {
	HBars,
	Legend,
	MiniBars,
	Ring,
	Spark,
	TrendChart,
} from "~/components/dashboard-viz"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import { Pill } from "~/components/ui/pill"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Stat } from "~/components/ui/stat"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table"
import type {
	DashboardAlert,
	DashboardExplainer,
	DashboardStat,
} from "~/lib/dashboard-stats"
import {
	ATTENTION_VISIBLE,
	COLLECTIONS_VISIBLE,
	type ExecAttentionKind,
	type ExecDashboardData,
	formatAmount,
	formatCompactMoney,
} from "~/lib/exec-dashboard"
import { financeStageLabelKey } from "~/lib/finance-pipeline"
import { cn } from "~/lib/utils"
import type { DocStatus, Role } from "../../generated/prisma/client"
import { CrewDashboard } from "./crew-dashboard"
import { WarehouseDashboard } from "./warehouse-dashboard"

type SendBackEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

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

function hasOverage(doc: DashboardDocRow): boolean {
	const estimated = toLines(doc.estimatedMaterials)
	const taken = toLines(doc.materialsTaken)
	if (estimated.length === 0 || taken.length === 0) return false
	const estimatedMap = Object.fromEntries(
		estimated.map((e) => [e.serviceCodeId, e.qty]),
	)
	return taken.some((t) => t.qty > (estimatedMap[t.serviceCodeId] ?? 0))
}

function hasQuantityDiscrepancy(doc: DashboardDocRow): boolean {
	const taken = toLines(doc.materialsTaken)
	const used = toLines(doc.materialsUsed)
	if (taken.length === 0 || used.length === 0) return false
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))
	const allIds = new Set([...Object.keys(takenMap), ...Object.keys(usedMap)])
	for (const id of allIds) {
		if ((takenMap[id] ?? 0) !== (usedMap[id] ?? 0)) return true
	}
	return false
}

function hasShortage(doc: DashboardDocRow): boolean {
	const returned = Array.isArray(doc.materialsReturned)
		? doc.materialsReturned
		: []
	return returned.some((line) => {
		if (typeof line !== "object" || line === null) return false
		const record = line as Record<string, unknown>
		return (
			typeof record.returnedQty === "number" &&
			typeof record.takenQty === "number" &&
			record.returnedQty < record.takenQty
		)
	})
}

type MaterialLine = { serviceCodeId: string; qty: number }

type DashboardDocRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
	avisoNumber?: string | null
	assignedCrewIds?: string[]
	sendBackHistory?: unknown
	estimatedMaterials?: unknown
	materialsTaken?: unknown
	materialsUsed?: unknown
	materialsReturned?: unknown
}

type CrewOption = { id: string; name: string }

type JobTypeOption = string

type RestockRequestRow = {
	id: string
	status: string
	createdAt: Date
	requestedBy: { name: string }
	warehouse: { name: string }
	items: unknown
}

type Greeting = "morning" | "afternoon" | "evening"

const GREETING_KEY: Record<Greeting, ParseKeys> = {
	morning: "dashboard.greeting.morning",
	afternoon: "dashboard.greeting.afternoon",
	evening: "dashboard.greeting.evening",
}

function emphasizeName(text: string, name: string) {
	const at = text.indexOf(name)
	if (at < 0) return text
	return (
		<>
			{text.slice(0, at)}
			<span className="text-primary">{name}</span>
			{text.slice(at + name.length)}
		</>
	)
}

const STATUS_BADGE_VARIANT: Record<
	DocStatus,
	"ok" | "warn" | "danger" | "info"
> = {
	CREATED: "warn",
	PREPPED: "info",
	SIGNED: "info",
	FIELD_UPDATED: "warn",
	SUPERVISOR_APPROVED: "info",
	CLARO_UPLOADED: "info",
	LC_REQUEST_GENERATED: "ok",
	CANCELLED: "danger",
}

const STATUS_LABEL_KEY: Record<DocStatus, StatusLabelKey> = {
	CREATED: "docs_status.created",
	PREPPED: "docs_status.prepped",
	SIGNED: "docs_status.signed",
	FIELD_UPDATED: "docs_status.field_updated",
	SUPERVISOR_APPROVED: "docs_status.supervisor_approved",
	CLARO_UPLOADED: "docs_status.claro_uploaded",
	LC_REQUEST_GENERATED: "docs_status.lc_request_generated",
	CANCELLED: "docs_status.cancelled",
}

type StatusLabelKey =
	| "dashboard.filter.status_all"
	| "docs_status.created"
	| "docs_status.prepped"
	| "docs_status.signed"
	| "docs_status.field_updated"
	| "docs_status.supervisor_approved"
	| "docs_status.claro_uploaded"
	| "docs_status.lc_request_generated"
	| "docs_status.cancelled"

const STATUS_OPTIONS: { value: string; labelKey: StatusLabelKey }[] = [
	{ value: "", labelKey: "dashboard.filter.status_all" },
	{ value: "CREATED", labelKey: "docs_status.created" },
	{ value: "PREPPED", labelKey: "docs_status.prepped" },
	{ value: "SIGNED", labelKey: "docs_status.signed" },
	{ value: "FIELD_UPDATED", labelKey: "docs_status.field_updated" },
	{ value: "SUPERVISOR_APPROVED", labelKey: "docs_status.supervisor_approved" },
	{ value: "CLARO_UPLOADED", labelKey: "docs_status.claro_uploaded" },
	{
		value: "LC_REQUEST_GENERATED",
		labelKey: "docs_status.lc_request_generated",
	},
	{ value: "CANCELLED", labelKey: "docs_status.cancelled" },
]

const ATTENTION_KEYS: Record<
	ExecAttentionKind,
	{ title: ParseKeys; desc: ParseKeys }
> = {
	po_short: {
		title: "dashboard.exec.attention.po_short_title",
		desc: "dashboard.exec.attention.po_short_desc",
	},
	aging: {
		title: "dashboard.exec.attention.aging_title",
		desc: "dashboard.exec.attention.aging_desc",
	},
	aviso_mismatch: {
		title: "dashboard.exec.attention.aviso_mismatch_title",
		desc: "dashboard.exec.attention.aviso_mismatch_desc",
	},
	missing_aviso: {
		title: "dashboard.exec.attention.missing_aviso_title",
		desc: "dashboard.exec.attention.missing_aviso_desc",
	},
	missing_claro_pdf: {
		title: "dashboard.exec.attention.missing_claro_pdf_title",
		desc: "dashboard.exec.attention.missing_claro_pdf_desc",
	},
	restock_approval: {
		title: "dashboard.exec.attention.restock_approval_title",
		desc: "dashboard.exec.attention.restock_approval_desc",
	},
}

const RESTOCK_STAGES: {
	key: "requested" | "pendingApproval" | "approved" | "ready"
	labelKey: ParseKeys
	variant: "neutral" | "warn" | "info" | "ok"
}[] = [
	{
		key: "requested",
		labelKey: "dashboard.exec.warehouse.requested",
		variant: "neutral",
	},
	{
		key: "pendingApproval",
		labelKey: "dashboard.exec.warehouse.pending_approval",
		variant: "warn",
	},
	{
		key: "approved",
		labelKey: "dashboard.exec.warehouse.approved",
		variant: "info",
	},
	{ key: "ready", labelKey: "dashboard.exec.warehouse.ready", variant: "ok" },
]

const CHART_ACCENT = "var(--chart-1)"
const CHART_SOFT = "var(--chart-2)"
const CHART_CRITICAL = "var(--status-danger)"

/** Card used for every dashboard panel: 16px radius, hairline border, soft shadow. */
function Box({
	title,
	sub,
	count,
	actions,
	accent = false,
	className,
	children,
}: {
	title?: React.ReactNode
	sub?: React.ReactNode
	count?: number
	actions?: React.ReactNode
	accent?: boolean
	className?: string
	children: React.ReactNode
}) {
	return (
		<section
			className={cn(
				"min-w-0 rounded-2xl border border-border bg-card p-5 shadow-xs",
				accent && "border-transparent bg-primary text-primary-foreground",
				className,
			)}
		>
			{title && (
				<div className="mb-3 flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h2
							className={cn(
								"flex items-center gap-2 text-xs font-bold tracking-wider uppercase",
								accent ? "text-primary-foreground/85" : "text-foreground",
							)}
						>
							{title}
							{count != null && count > 0 && (
								<span className="inline-flex min-w-5 items-center justify-center rounded-sm bg-status-danger px-1.5 text-[11px] font-semibold text-white">
									{count}
								</span>
							)}
						</h2>
						{sub && (
							<p
								className={cn(
									"mt-0.5 text-xs",
									accent
										? "text-primary-foreground/75"
										: "text-muted-foreground",
								)}
							>
								{sub}
							</p>
						)}
					</div>
					{actions && <div className="shrink-0">{actions}</div>}
				</div>
			)}
			{children}
		</section>
	)
}

function DocLink({
	to,
	children,
	className,
}: {
	to: string
	children: React.ReactNode
	className?: string
}) {
	return (
		<Link
			to={to}
			className={cn(
				"block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40",
				className,
			)}
		>
			{children}
		</Link>
	)
}

function latestSendBack(doc: DashboardDocRow): SendBackEntry | null {
	const raw = doc.sendBackHistory
	if (raw == null || !Array.isArray(raw)) return null
	const history = raw as SendBackEntry[]
	if (history.length === 0) return null
	return history[history.length - 1]
}

/** One role queue: heading with count badge and a list of document links. */
function DocQueue({
	headingKey,
	badgeKey,
	variant,
	docs,
	href,
	showNote = false,
}: {
	headingKey: ParseKeys
	badgeKey: ParseKeys
	variant: "warn" | "danger" | "info"
	docs: DashboardDocRow[]
	href: (doc: DashboardDocRow) => string
	showNote?: boolean
}) {
	const { t } = useTranslation()
	if (docs.length === 0) return null
	return (
		<Box
			title={t(headingKey, { count: docs.length })}
			actions={<Badge variant={variant}>{docs.length}</Badge>}
		>
			<div className="space-y-1">
				{docs.map((doc) => {
					const latest = showNote ? latestSendBack(doc) : null
					return (
						<DocLink key={doc.id} to={href(doc)}>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono font-medium">
									{doc.controlNumber}
								</span>
								<Badge variant={variant}>{t(badgeKey)}</Badge>
							</div>
							{latest && (
								<p className="mt-1 text-xs text-muted-foreground line-clamp-2">
									{t("dashboard.sent_back_note", { note: latest.note })}
								</p>
							)}
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
						</DocLink>
					)
				})}
			</div>
		</Box>
	)
}

function KpiIcon({
	className,
	children,
}: {
	className: string
	children: React.ReactNode
}) {
	return (
		<span
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full",
				className,
			)}
		>
			{children}
		</span>
	)
}

function ExecKpis({ exec }: { exec: ExecDashboardData }) {
	const { t } = useTranslation()
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
			<Stat
				label={t("dashboard.exec.kpi.waiting_on_claro")}
				value={formatCompactMoney(exec.money.open)}
				detail={t("dashboard.exec.kpi.waiting_on_claro_detail")}
				tone={exec.money.open > 0 ? "danger" : "default"}
				icon={
					<KpiIcon className="bg-status-ok/15 text-status-ok">
						<svg
							aria-hidden="true"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</KpiIcon>
				}
				viz={
					<Ring
						pct={exec.money.openPct}
						tone="critical"
						caption={t("dashboard.exec.kpi.open_caption")}
						label={t("dashboard.exec.kpi.open_ring_label", {
							pct: exec.money.openPct,
						})}
					/>
				}
			/>
			<Stat
				label={t("dashboard.exec.kpi.jobs_in_field")}
				value={exec.field.inField}
				detail={t("dashboard.exec.kpi.jobs_in_field_detail", {
					count: exec.field.bySupervisor.length,
				})}
				icon={
					<KpiIcon className="bg-status-info/15 text-status-info">
						<svg
							aria-hidden="true"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
							/>
						</svg>
					</KpiIcon>
				}
				viz={
					<MiniBars
						values={exec.field.bySupervisor.map((s) => s.count)}
						label={t("dashboard.exec.kpi.jobs_bars_label")}
					/>
				}
			/>
			<Stat
				label={t("dashboard.exec.kpi.avisos_year")}
				value={exec.avisos.count.toLocaleString()}
				detail={t("dashboard.exec.kpi.avisos_year_detail", {
					amount: formatCompactMoney(exec.money.sold),
				})}
				icon={
					<KpiIcon className="bg-purple-500/15 text-purple-600 dark:text-purple-400">
						<svg
							aria-hidden="true"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</KpiIcon>
				}
				viz={
					<Spark
						values={exec.months.map((m) => m.avisos)}
						label={t("dashboard.exec.kpi.avisos_spark_label")}
					/>
				}
			/>
			<Stat
				label={t("dashboard.exec.kpi.avisos_no_po")}
				value={exec.avisos.noPo}
				detail={t("dashboard.exec.kpi.avisos_no_po_detail", {
					count: exec.avisos.receivablesOpen,
				})}
				icon={
					<KpiIcon className="bg-orange-500/15 text-orange-600 dark:text-orange-400">
						<svg
							aria-hidden="true"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
							/>
						</svg>
					</KpiIcon>
				}
				viz={
					<Ring
						pct={exec.avisos.noPoPct}
						caption={t("dashboard.exec.kpi.of_all_caption")}
						label={t("dashboard.exec.kpi.no_po_ring_label", {
							pct: exec.avisos.noPoPct,
						})}
					/>
				}
			/>
			<Stat
				label={t("dashboard.exec.kpi.active_installers")}
				value={exec.field.installersTotal}
				detail={t("dashboard.exec.kpi.active_installers_detail", {
					count: exec.field.brigadesActive,
				})}
				icon={
					<KpiIcon className="bg-status-ok/15 text-status-ok">
						<svg
							aria-hidden="true"
							className="size-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
							/>
						</svg>
					</KpiIcon>
				}
				viz={
					<MiniBars
						values={exec.field.brigadesByArea.map((a) => a.count)}
						label={t("dashboard.exec.kpi.brigades_bars_label")}
					/>
				}
			/>
		</div>
	)
}

function AttentionList({ exec }: { exec: ExecDashboardData }) {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)
	const items = exec.attention
	const visible = expanded ? items : items.slice(0, ATTENTION_VISIBLE)
	const hidden = items.length - ATTENTION_VISIBLE
	if (items.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("dashboard.exec.attention.empty")}
			</p>
		)
	}
	return (
		<>
			<ul className="divide-y divide-border">
				{visible.map((item) => {
					const keys = ATTENTION_KEYS[item.kind]
					const critical = item.level === "critical"
					return (
						<li key={item.id}>
							<Link
								to={item.href}
								className="grid grid-cols-[3px_1fr_auto] items-start gap-x-3 py-2.5 transition-colors hover:bg-muted/40"
							>
								<span
									className={cn(
										"mt-0.5 min-h-7 w-[3px] rounded-sm",
										critical ? "bg-status-danger" : "bg-status-warn",
									)}
								/>
								<span className="min-w-0">
									<span className="block text-[13.5px] font-semibold text-foreground">
										{t(keys.title, item.params)}
									</span>
									<span className="block text-xs text-muted-foreground">
										{t(keys.desc, item.params)}
									</span>
								</span>
								<span
									className={cn(
										"pt-0.5 text-[11px] font-semibold",
										critical ? "text-status-danger" : "text-status-warn",
									)}
								>
									{critical
										? t("dashboard.exec.attention.critical")
										: t("dashboard.exec.attention.watch")}
								</span>
							</Link>
						</li>
					)
				})}
			</ul>
			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-2.5 text-xs font-semibold text-primary hover:underline"
				>
					{expanded
						? t("dashboard.exec.attention.show_less")
						: t("dashboard.exec.attention.more", { count: hidden })}
				</button>
			)}
		</>
	)
}

/** Pipeline + Exceptions: simplified overview of stage counts and quality issues */
function PipelineExceptions({
	stats,
}: {
	stats: DashboardStat[]
	exec?: ExecDashboardData | null
}) {
	const { t } = useTranslation()

	// Extract stage counts from stats
	const totalDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.total_documents")?.value ??
		0
	const claroDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.awaiting_claro_upload")
			?.value ?? 0
	const warehouseDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.stage_awaiting_warehouse")
			?.value ?? 0
	const crewDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.stage_awaiting_crew")
			?.value ?? 0
	const reviewDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.stage_pending_review")
			?.value ?? 0
	const financeDocs =
		stats.find((s) => s.labelKey === "dashboard.stat.stage_in_finance")
			?.value ?? 0

	const discrepancies =
		stats.find((s) => s.labelKey === "dashboard.stat.discrepancy_count")
			?.value ?? 0
	const shortages =
		stats.find((s) => s.labelKey === "dashboard.stat.shortage_count")?.value ??
		0
	const overages =
		stats.find((s) => s.labelKey === "dashboard.stat.overage_count")?.value ?? 0
	const aging =
		stats.find((s) => s.labelKey === "dashboard.stat.aging_po_wait_count")
			?.value ?? 0

	const hasExceptions =
		discrepancies > 0 || shortages > 0 || overages > 0 || aging > 0
	const activeDocs = totalDocs
	const filledStages = [
		totalDocs,
		claroDocs,
		warehouseDocs,
		crewDocs,
		reviewDocs,
		financeDocs,
	].filter((n) => n > 0).length
	const completionPct = Math.round((filledStages / 6) * 100)

	return (
		<div className="grid gap-4 lg:grid-cols-12">
			{/* Pipeline - remaining space (67%) */}
			<Box
				title={
					<div className="flex items-center gap-2">
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
							/>
						</svg>
						{t("dashboard.exec.pipeline.title")}
					</div>
				}
				sub={t("dashboard.exec.pipeline.count", { count: activeDocs })}
				className="lg:col-span-8"
				actions={
					<Link
						to="/finance/receivables"
						className="text-xs font-semibold text-primary hover:underline"
					>
						{t("dashboard.exec.pipeline.view")} →
					</Link>
				}
			>
				<div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
					{/* Documents */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-status-ok/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-status-ok/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-status-ok"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{totalDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.documents")}
						</div>
					</div>

					{/* Claro */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-sky-500/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-sky-500/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-sky-600 dark:text-sky-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{claroDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.claro")}
						</div>
					</div>

					{/* Warehouse */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-purple-500/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-purple-500/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-purple-600 dark:text-purple-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{warehouseDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.warehouse")}
						</div>
					</div>

					{/* Crew */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-orange-500/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-orange-500/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-orange-600 dark:text-orange-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{crewDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.crew")}
						</div>
					</div>

					{/* Review */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-violet-500/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-violet-500/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-violet-600 dark:text-violet-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{reviewDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.review")}
						</div>
					</div>

					{/* Finance */}
					<div className="flex flex-col items-center gap-1.5 rounded-lg bg-status-ok/10 py-3 px-2 text-center">
						<div className="flex size-7 items-center justify-center rounded-md bg-status-ok/15">
							<svg
								aria-hidden="true"
								className="size-3.5 text-status-ok"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<div className="text-lg font-bold tabular-nums leading-none">
							{financeDocs}
						</div>
						<div className="text-[9px] text-muted-foreground leading-tight font-medium">
							{t("dashboard.exec.pipeline.finance")}
						</div>
					</div>
				</div>
				<div className="mt-3 border-t border-border pt-3">
					<span className="text-xs text-muted-foreground">
						{t("dashboard.exec.pipeline.active", { count: activeDocs })}
					</span>
					<div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-status-ok transition-all"
							style={{ width: `${completionPct}%` }}
						/>
					</div>
				</div>
			</Box>

			{/* Exceptions - 33% */}
			<Box
				title={
					<div className="flex items-center gap-2">
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
						{t("dashboard.exec.exceptions.title")}
					</div>
				}
				className="lg:col-span-4"
				actions={
					<Link
						to="/finance/receivables"
						className="text-xs font-semibold text-primary hover:underline"
					>
						{t("dashboard.exec.exceptions.view_all")} →
					</Link>
				}
			>
				{hasExceptions ? (
					<div className="space-y-2">
						{discrepancies > 0 && (
							<div className="flex items-center justify-between rounded-lg border border-status-warn/20 bg-status-warn-soft px-3 py-2">
								<span className="text-xs font-medium">
									{t("dashboard.exec.exceptions.discrepancies")}
								</span>
								<Badge variant="warn">{discrepancies}</Badge>
							</div>
						)}
						{shortages > 0 && (
							<div className="flex items-center justify-between rounded-lg border border-status-info/20 bg-status-info-soft px-3 py-2">
								<span className="text-xs font-medium">
									{t("dashboard.exec.exceptions.shortages")}
								</span>
								<Badge variant="info">{shortages}</Badge>
							</div>
						)}
						{overages > 0 && (
							<div className="flex items-center justify-between rounded-lg border border-status-danger/20 bg-status-danger-soft px-3 py-2">
								<span className="text-xs font-medium">
									{t("dashboard.exec.exceptions.overages")}
								</span>
								<Badge variant="danger">{overages}</Badge>
							</div>
						)}
						{aging > 0 && (
							<div className="flex items-center justify-between rounded-lg border border-status-warn/20 bg-status-warn-soft px-3 py-2">
								<span className="text-xs font-medium">
									{t("dashboard.exec.exceptions.aging")}
								</span>
								<Badge variant="warn">{aging}</Badge>
							</div>
						)}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-6">
						<div className="mb-3 flex size-12 items-center justify-center rounded-full bg-status-ok/10">
							<svg
								aria-hidden="true"
								className="size-6 text-status-ok"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M5 13l4 4L19 7"
								/>
							</svg>
						</div>
						<div className="text-base font-semibold">
							{t("dashboard.exec.exceptions.all_clear")}
						</div>
						<p className="mt-1 max-w-[28ch] text-center text-xs text-muted-foreground">
							{t("dashboard.exec.exceptions.all_clear_sub")}
						</p>
					</div>
				)}
			</Box>
		</div>
	)
}

function ExecGrid({
	exec,
	userRole,
}: {
	exec: ExecDashboardData
	userRole?: Role
}) {
	const { t, i18n } = useTranslation()
	const money = exec.money
	const hasSales = money.sold > 0
	const monthLabel = (m: number) =>
		new Date(exec.year, m, 1).toLocaleDateString(i18n.language, {
			month: "short",
		})
	const shortDate = (d: Date) =>
		new Date(d).toLocaleDateString(i18n.language, {
			day: "numeric",
			month: "short",
		})
	const canApproveRestock = userRole === "ADMIN"
	const restockOpen =
		exec.warehouse.requested +
		exec.warehouse.pendingApproval +
		exec.warehouse.approved +
		exec.warehouse.ready
	const collectionsVisible = exec.collections.slice(0, COLLECTIONS_VISIBLE)
	const collectionsHidden = exec.collections.length - COLLECTIONS_VISIBLE

	return (
		<div className="space-y-4">
			{/* Row 1: Attention + Money + Chart + Glance */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
				{/* Needs your attention - 33% */}
				<Box
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
								/>
							</svg>
							{t("dashboard.exec.attention.title")}
						</div>
					}
					actions={
						<Link
							to="/finance/receivables"
							className="text-xs font-semibold text-primary hover:underline"
						>
							{t("dashboard.exec.attention.view_all")} →
						</Link>
					}
					className="lg:col-span-4"
				>
					{exec.attention.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-10">
							<div className="mb-3 flex size-16 items-center justify-center rounded-full bg-status-ok/10">
								<svg
									aria-hidden="true"
									className="size-8 text-status-ok"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
							<div className="text-sm font-medium text-center">
								{t("dashboard.exec.attention.empty")}
							</div>
							<p className="mt-1 text-xs text-muted-foreground text-center">
								{t("dashboard.exec.attention.caught_up")}
							</p>
						</div>
					) : (
						<AttentionList exec={exec} />
					)}
				</Box>

				{/* Money out the door - same as Sold vs PO */}
				<Box
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							{t("dashboard.exec.money.title")}
						</div>
					}
					className="lg:col-span-2"
				>
					<div className="text-3xl leading-none font-bold tracking-tight mb-1.5">
						${formatAmount(money.open)}
					</div>
					<p className="mb-3 text-[11px] text-muted-foreground">
						{t("dashboard.exec.money.heroline", { year: exec.year })}
					</p>
					<div className="space-y-2">
						{[
							{
								label: t("dashboard.exec.money.sold"),
								value: money.sold,
								color: CHART_ACCENT,
							},
							{
								label: t("dashboard.exec.money.po_received"),
								value: money.poReceived,
								color: CHART_SOFT,
							},
							{
								label: t("dashboard.exec.money.balance_open"),
								value: money.open,
								color: CHART_CRITICAL,
							},
						].map((line) => (
							<div key={line.label} className="flex items-center gap-2 text-xs">
								<i
									className="size-2 shrink-0 rounded-full"
									style={{ background: line.color }}
								/>
								<span className="flex-1">{line.label}</span>
								<span className="font-semibold tabular-nums">
									${line.value === 0 ? "0" : formatCompactMoney(line.value)}
								</span>
							</div>
						))}
					</div>
				</Box>

				{/* Sold vs POs by month - same as Money */}
				<Box
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
							{t("dashboard.exec.trend.title")}
						</div>
					}
					className="lg:col-span-2"
				>
					{hasSales ? (
						<>
							<Legend
								className="mb-1.5"
								items={[
									{ label: t("dashboard.exec.trend.sold"), tone: "accent" },
									{ label: t("dashboard.exec.trend.po"), tone: "soft" },
								]}
							/>
							<TrendChart
								points={exec.months.map((m) => ({
									label: monthLabel(m.month),
									sold: m.sold,
									po: m.po,
								}))}
								seriesLabels={{
									sold: t("dashboard.exec.trend.sold"),
									po: t("dashboard.exec.trend.po"),
								}}
								openLabel={t("dashboard.exec.trend.still_open")}
								format={formatCompactMoney}
							/>
						</>
					) : (
						<div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
							{t("dashboard.exec.trend.empty")}
						</div>
					)}
				</Box>

				{/* Today at a glance - 33% */}
				<Box
					accent
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							{t("dashboard.exec.glance.title")}
						</div>
					}
					className="lg:col-span-4"
				>
					<div className="text-3xl leading-none font-bold tracking-tight mb-1.5">
						{t("dashboard.exec.items", { count: exec.attention.length })}
					</div>
					<p className="mb-4 text-xs text-primary-foreground/85">
						{exec.attention.length > 0
							? t("dashboard.exec.glance.sub")
							: t("dashboard.exec.glance.all_clear")}
					</p>
					<div className="space-y-2">
						{exec.shortPoCount > 0 && (
							<Link
								to="/finance/receivables?stage=PO_RECEIVED_UPLOAD"
								className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-foreground px-4 py-2.5 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
							>
								{t("dashboard.exec.glance.review_short_pos", {
									count: exec.shortPoCount,
								})}
							</Link>
						)}
						<Link
							to="/finance/receivables"
							className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-foreground px-4 py-2.5 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
						>
							{t("dashboard.exec.glance.open_pipeline")}
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M13 7l5 5m0 0l-5 5m5-5H6"
								/>
							</svg>
						</Link>
						{canApproveRestock && exec.warehouse.pendingApproval > 0 && (
							<Link
								to="/admin/restock"
								className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-foreground px-4 py-2.5 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
							>
								{t("dashboard.exec.glance.approve_restock")}
							</Link>
						)}
					</div>
				</Box>
			</div>

			{/* Row 2: Field and Warehouse */}
			<div className="grid gap-4 lg:grid-cols-2">
				{/* Field today */}
				<Box
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
								/>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
							{t("dashboard.exec.field.title")}
						</div>
					}
					sub={t("dashboard.exec.field.sub")}
				>
					{exec.field.bySupervisor.length > 0 ? (
						<HBars
							rows={exec.field.bySupervisor
								.slice(0, 6)
								.map((s) => ({ name: s.name, value: s.count }))}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("dashboard.exec.field.empty")}
						</p>
					)}
					<div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-border pt-3.5">
						<div>
							<div className="text-xs text-muted-foreground">
								{t("dashboard.exec.field.installers_on_road")}
							</div>
							<div className="text-xl leading-tight font-semibold tracking-tight">
								{exec.field.installersOnRoad}{" "}
								<span className="text-xs font-medium text-muted-foreground">
									{t("dashboard.exec.field.of_total", {
										count: exec.field.installersTotal,
									})}
								</span>
							</div>
						</div>
						<div>
							<div className="text-xs text-muted-foreground">
								{t("dashboard.exec.field.paid_this_week")}
							</div>
							<div className="text-xl leading-tight font-semibold tracking-tight">
								{formatCompactMoney(exec.field.paidThisWeek)}
							</div>
						</div>
					</div>
				</Box>

				{/* Warehouse */}
				<Box
					title={
						<div className="flex items-center gap-2">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
								/>
							</svg>
							{t("dashboard.exec.warehouse.title")}
						</div>
					}
					sub={t("dashboard.exec.warehouse.sub")}
				>
					{restockOpen > 0 ? (
						<ul className="divide-y divide-border">
							{RESTOCK_STAGES.map((stage) => (
								<li
									key={stage.key}
									className="flex items-center justify-between gap-3 py-2 text-sm"
								>
									<span>{t(stage.labelKey)}</span>
									<Badge variant={stage.variant}>
										{exec.warehouse[stage.key]}
									</Badge>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("dashboard.exec.warehouse.empty")}
						</p>
					)}
					{exec.warehouse.byWarehouse.length > 0 && (
						<div className="mt-3 border-t border-border pt-3">
							<div className="mb-1 text-xs text-muted-foreground">
								{t("dashboard.exec.warehouse.by_warehouse")}
							</div>
							<HBars
								rows={exec.warehouse.byWarehouse.map((w) => ({
									name: w.name,
									value: w.count,
								}))}
							/>
						</div>
					)}
					{canApproveRestock && (
						<Button
							variant="outline"
							size="sm"
							className="mt-3.5"
							render={<Link to="/admin/restock" />}
							nativeButton={false}
						>
							{t("dashboard.exec.warehouse.open_queue")}
						</Button>
					)}
				</Box>
			</div>

			{/* Row 3: Collections - full width */}
			<Box
				title={t("dashboard.exec.collections.title")}
				sub={t("dashboard.exec.collections.sub")}
			>
				{collectionsVisible.length === 0 ? (
					<EmptyState title={t("dashboard.exec.collections.empty")} />
				) : (
					<Table className="text-xs">
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("dashboard.exec.collections.col.aviso")}
								</TableHead>
								<TableHead>
									{t("dashboard.exec.collections.col.brigade_paid")}
								</TableHead>
								<TableHead className="text-right">
									{t("dashboard.exec.collections.col.sold")}
								</TableHead>
								<TableHead className="text-right">
									{t("dashboard.exec.collections.col.po_received")}
								</TableHead>
								<TableHead className="text-right">
									{t("dashboard.exec.collections.col.balance")}
								</TableHead>
								<TableHead>
									{t("dashboard.exec.collections.col.stage")}
								</TableHead>
								<TableHead className="text-right">
									{t("dashboard.exec.collections.col.days_out")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{collectionsVisible.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="font-mono text-xs">
										<Link to={`/docs/${row.id}`} className="hover:underline">
											{row.avisoNumber ?? row.controlNumber}
										</Link>
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{row.brigadePaidAt ? (
											shortDate(row.brigadePaidAt)
										) : (
											<span className="text-muted-foreground">
												{t("dashboard.exec.collections.not_paid")}
											</span>
										)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatAmount(row.sold)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatAmount(row.po)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-status-danger">
										{formatAmount(row.balance)}
									</TableCell>
									<TableCell>
										<span className="flex flex-wrap items-center gap-1.5">
											{row.stage && t(financeStageLabelKey(row.stage))}
											<Badge
												variant={row.problem === "po_short" ? "danger" : "warn"}
											>
												{row.problem === "po_short"
													? t("dashboard.exec.collections.po_short")
													: t("dashboard.exec.collections.no_po")}
											</Badge>
										</span>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.daysOut}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
				{collectionsHidden > 0 && (
					<Link
						to="/finance/receivables"
						className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
					>
						{t("dashboard.exec.collections.more", { count: collectionsHidden })}
					</Link>
				)}
			</Box>
		</div>
	)
}

function DashboardView({
	stats,
	alert,
	explainer: _explainer,
	docs,
	exec = null,
	userRole,
	userName,
	greeting = "morning",
	todayIso,
	showFilters = false,
	pendingReviewDocs = [],
	sentBackDocs = [],
	crewOptions = [],
	jobTypeOptions = [],
	selectedStatus = null,
	selectedCrew = null,
	selectedJobType = null,
	searchFilter = "",
	warehousePreppedDocs = [],
	warehouseMissingDocs = [],
	warehouseReturnsDocs = [],
	crewPreppedDocs = [],
	crewInFieldDocs = [],
	crewSentBackDocs = [],
	crewSubmittedDocs = [],
	restockRequests = [],
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	explainer: DashboardExplainer
	docs: DashboardDocRow[]
	/** Executive figures (FINANCE / ADMIN). Null hides the command-center panels. */
	exec?: ExecDashboardData | null
	userRole?: Role
	userName?: string
	greeting?: Greeting
	todayIso?: string
	showFilters?: boolean
	pendingReviewDocs?: DashboardDocRow[]
	sentBackDocs?: DashboardDocRow[]
	crewOptions?: CrewOption[]
	jobTypeOptions?: JobTypeOption[]
	selectedStatus?: string | null
	selectedCrew?: string | null
	selectedJobType?: string | null
	searchFilter?: string
	warehousePreppedDocs?: DashboardDocRow[]
	warehouseMissingDocs?: DashboardDocRow[]
	warehouseReturnsDocs?: DashboardDocRow[]
	crewPreppedDocs?: DashboardDocRow[]
	crewInFieldDocs?: DashboardDocRow[]
	crewSentBackDocs?: DashboardDocRow[]
	crewSubmittedDocs?: DashboardDocRow[]
	restockRequests?: RestockRequestRow[]
}) {
	const { t, i18n } = useTranslation()
	const location = useLocation()

	if (userRole === "WAREHOUSE") {
		return (
			<WarehouseDashboard
				stats={stats}
				alert={alert}
				docs={docs}
				userName={userName}
				greeting={greeting}
				todayIso={todayIso}
				showFilters={showFilters}
				jobTypeOptions={jobTypeOptions}
				selectedStatus={selectedStatus}
				selectedJobType={selectedJobType}
				searchFilter={searchFilter}
				warehousePreppedDocs={warehousePreppedDocs}
				warehouseMissingDocs={warehouseMissingDocs}
				warehouseReturnsDocs={warehouseReturnsDocs}
				restockRequests={restockRequests}
			/>
		)
	}

	if (userRole === "CREW") {
		return (
			<CrewDashboard
				stats={stats}
				alert={alert}
				docs={docs}
				userName={userName}
				greeting={greeting}
				todayIso={todayIso}
				showFilters={showFilters}
				jobTypeOptions={jobTypeOptions}
				selectedStatus={selectedStatus}
				selectedJobType={selectedJobType}
				searchFilter={searchFilter}
				crewPreppedDocs={crewPreppedDocs}
				crewInFieldDocs={crewInFieldDocs}
				crewSentBackDocs={crewSentBackDocs}
				crewSubmittedDocs={crewSubmittedDocs}
			/>
		)
	}

	const hasActiveFilters =
		!!selectedStatus || !!selectedCrew || !!selectedJobType || !!searchFilter

	const firstName = userName?.trim().split(/\s+/)[0]
	const todayLabel = todayIso
		? new Date(todayIso).toLocaleDateString(i18n.language, {
				weekday: "long",
				day: "numeric",
				month: "long",
			})
		: null

	const navigateWith = (mutate: (params: URLSearchParams) => void) => {
		const params = new URLSearchParams(location.search)
		mutate(params)
		const query = params.toString()
		window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
	}

	return (
		<div>
			{/* Greeting */}
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="min-w-0">
					{todayLabel && (
						<div className="mb-1 text-sm text-muted-foreground capitalize">
							{todayLabel}
						</div>
					)}
					<h1 className="text-3xl leading-tight font-bold tracking-tight text-foreground">
						{firstName
							? emphasizeName(
									t(GREETING_KEY[greeting], {
										name: firstName,
										interpolation: { escapeValue: false },
									}),
									firstName,
								)
							: t("dashboard.title")}
					</h1>
					<p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
						{exec ? (
							<Trans
								i18nKey="dashboard.exec.summary"
								values={{
									jobs: t("dashboard.exec.jobs", {
										count: exec.field.inField,
									}),
									open: formatCompactMoney(exec.money.open),
									items: t("dashboard.exec.items", {
										count: exec.attention.length,
									}),
								}}
								components={{
									b: <b className="font-semibold text-foreground" />,
								}}
							/>
						) : (
							t("dashboard.subtitle")
						)}
					</p>
				</div>
				{showFilters && hasActiveFilters && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							window.location.href = location.pathname
						}}
						className="shrink-0 text-xs"
					>
						<HugeiconsIcon
							icon={RemoveIcon}
							strokeWidth={2}
							className="size-3 mr-1"
						/>
						{t("dashboard.filter.clear_all")}
					</Button>
				)}
			</div>

			<div className="space-y-5">
				{showFilters && (
					<div className="rounded-2xl border border-border bg-card p-3 space-y-3 shadow-xs">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<HugeiconsIcon
								icon={FilterIcon}
								strokeWidth={2}
								className="size-4"
							/>
							{t("dashboard.filter.heading")}
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
							<Select
								value={selectedStatus || ""}
								onValueChange={(v) =>
									navigateWith((p) => {
										if (v) p.set("status", v)
										else p.delete("status")
									})
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={t("dashboard.filter.status_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{STATUS_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{t(opt.labelKey)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<Select
								value={selectedCrew || ""}
								onValueChange={(v) =>
									navigateWith((p) => {
										if (v) p.set("crew", v)
										else p.delete("crew")
									})
								}
								disabled={crewOptions.length === 0}
							>
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={t("dashboard.filter.crew_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{crewOptions.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<Select
								value={selectedJobType || ""}
								onValueChange={(v) =>
									navigateWith((p) => {
										if (v) p.set("jobType", v)
										else p.delete("jobType")
									})
								}
								disabled={!(jobTypeOptions && jobTypeOptions.length > 0)}
							>
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={t("dashboard.filter.job_type_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{(jobTypeOptions || []).map((jt) => (
										<SelectItem key={jt} value={jt}>
											{jt}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<form
								method="get"
								className="relative"
								onSubmit={(e) => {
									e.preventDefault()
									const formData = new FormData(e.currentTarget)
									const search = (formData.get("search") as string).trim()
									navigateWith((p) => {
										if (search) p.set("search", search)
										else p.delete("search")
									})
								}}
							>
								<HugeiconsIcon
									icon={SearchIcon}
									strokeWidth={2}
									className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
								/>
								<Input
									name="search"
									type="search"
									placeholder={t("dashboard.filter.search_placeholder")}
									defaultValue={searchFilter}
									className="pl-9"
								/>
							</form>
						</div>
					</div>
				)}

				{alert && (
					<Pill variant={alert.variant}>
						{t(alert.key, { count: alert.count })}
					</Pill>
				)}

				{!exec && stats.length > 0 && (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
						{stats.map((stat) => (
							<Stat
								key={stat.labelKey}
								label={t(stat.labelKey)}
								value={stat.value}
							/>
						))}
					</div>
				)}

				{exec && <ExecKpis exec={exec} />}

				{exec && stats.length > 0 && (
					<PipelineExceptions stats={stats} exec={exec} />
				)}

				{exec && <ExecGrid exec={exec} userRole={userRole} />}

				<div className="grid gap-4 lg:grid-cols-2">
					{pendingReviewDocs.length > 0 && (
						<Box
							title={t("dashboard.pending_review_heading", {
								count: pendingReviewDocs.length,
							})}
							actions={<Badge variant="warn">{pendingReviewDocs.length}</Badge>}
						>
							<div className="space-y-1">
								{pendingReviewDocs.map((doc) => (
									<DocLink key={doc.id} to={`/docs/${doc.id}/review`}>
										<div className="flex items-center justify-between gap-2">
											<span className="font-mono font-medium">
												{doc.controlNumber}
											</span>
											<span className="text-muted-foreground truncate">
												{doc.jobType} — {doc.jobAddressEstimated}
											</span>
										</div>
									</DocLink>
								))}
							</div>
						</Box>
					)}

					<DocQueue
						headingKey="dashboard.sent_back_heading"
						badgeKey="dashboard.sent_back_badge"
						variant="warn"
						docs={sentBackDocs}
						href={(doc) => `/docs/${doc.id}`}
						showNote
					/>
					<DocQueue
						headingKey="dashboard.ready_for_pickup_heading"
						badgeKey="dashboard.ready_for_pickup_badge"
						variant="info"
						docs={crewPreppedDocs}
						href={(doc) => `/docs/${doc.id}/sign`}
					/>
					<DocQueue
						headingKey="dashboard.in_the_field_heading"
						badgeKey="dashboard.in_the_field_badge"
						variant="warn"
						docs={crewInFieldDocs}
						href={(doc) => `/docs/${doc.id}/field`}
					/>
					<DocQueue
						headingKey="dashboard.crew_sent_back_heading"
						badgeKey="dashboard.sent_back_badge"
						variant="warn"
						docs={crewSentBackDocs}
						href={(doc) => `/docs/${doc.id}/field`}
						showNote
					/>
					<DocQueue
						headingKey="dashboard.submitted_heading"
						badgeKey="dashboard.submitted_badge"
						variant="info"
						docs={crewSubmittedDocs}
						href={(doc) => `/docs/${doc.id}`}
					/>
					<DocQueue
						headingKey="dashboard.prepped_awaiting_heading"
						badgeKey="dashboard.prepped_awaiting_badge"
						variant="info"
						docs={warehousePreppedDocs}
						href={(doc) => `/docs/${doc.id}/sign`}
					/>
					<DocQueue
						headingKey="dashboard.missing_materials_heading"
						badgeKey="dashboard.missing_materials_badge"
						variant="danger"
						docs={warehouseMissingDocs}
						href={(doc) => `/docs/${doc.id}/prep`}
					/>
					<DocQueue
						headingKey="dashboard.returns_to_log_heading"
						badgeKey="dashboard.returns_to_log_badge"
						variant="warn"
						docs={warehouseReturnsDocs}
						href={(doc) => `/docs/${doc.id}/returns`}
					/>

					{restockRequests.length > 0 && (
						<Box
							title={t("dashboard.restock_requests_heading", {
								count: restockRequests.length,
							})}
							actions={<Badge variant="warn">{restockRequests.length}</Badge>}
						>
							<div className="space-y-1">
								{restockRequests.map((req) => (
									<DocLink key={req.id} to={`/restock/${req.id}/fulfill`}>
										<div className="flex items-center justify-between gap-2">
											<span className="font-mono font-medium">
												#{req.id.slice(-6)}
											</span>
											<Badge variant="warn">
												{t("dashboard.restock_requests_badge")}
											</Badge>
										</div>
										<p className="mt-1 text-xs text-muted-foreground/70">
											{req.requestedBy?.name ?? "Installer"} —{" "}
											{req.warehouse?.name ?? "Warehouse"}
										</p>
									</DocLink>
								))}
							</div>
						</Box>
					)}
				</div>

				<Box
					title={t("dashboard.recent_documents")}
					sub={t("dashboard.recent_documents_sub")}
					actions={
						docs.length > 0 ? (
							<Badge variant="neutral">{docs.length}</Badge>
						) : undefined
					}
				>
					{docs.length === 0 && (
						<EmptyState title={t("dashboard.no_documents")} />
					)}
					<div className="space-y-1">
						{docs.map((doc) => {
							const overage = hasOverage(doc)
							const discrepancy = hasQuantityDiscrepancy(doc)
							const shortage = hasShortage(doc)
							return (
								<DocLink key={doc.id} to={`/docs/${doc.id}`} className="p-3">
									<div className="flex items-center justify-between gap-2">
										<span className="font-mono text-sm font-medium">
											{doc.controlNumber}
										</span>
										<div className="flex items-center gap-2">
											<Badge variant={STATUS_BADGE_VARIANT[doc.status]}>
												{t(STATUS_LABEL_KEY[doc.status])}
											</Badge>
											<HugeiconsIcon
												icon={ChevronRightIcon}
												strokeWidth={2}
												className="size-4 shrink-0 text-muted-foreground"
											/>
										</div>
									</div>
									<p className="mt-1 text-sm text-muted-foreground">
										{doc.jobType} — {doc.jobAddressEstimated}
									</p>
									{(overage || discrepancy || shortage) && (
										<div className="mt-2 flex flex-wrap items-center gap-1">
											{overage && (
												<Badge variant="danger" className="text-xs">
													{t("dashboard.signal.overage")}
												</Badge>
											)}
											{discrepancy && (
												<Badge variant="warn" className="text-xs">
													{t("dashboard.signal.discrepancy")}
												</Badge>
											)}
											{shortage && (
												<Badge variant="info" className="text-xs">
													{t("dashboard.signal.shortage")}
												</Badge>
											)}
											<span className="ml-1 text-xs font-medium text-primary">
												{t("dashboard.action.review_signal")}
											</span>
										</div>
									)}
									{doc.avisoNumber && (
										<p className="mt-1 text-xs text-muted-foreground/70">
											{t("dashboard.aviso_number")} {doc.avisoNumber}
										</p>
									)}
									{doc.createdAt && (
										<p className="mt-1 text-xs text-muted-foreground/70">
											{doc.createdAt.toLocaleDateString()}
										</p>
									)}
								</DocLink>
							)
						})}
					</div>
				</Box>
			</div>
		</div>
	)
}

export type { Greeting }
export { DashboardView }

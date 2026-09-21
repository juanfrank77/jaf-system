import {
	ChevronRightIcon,
	File01Icon,
	Notification01Icon,
	RemoveIcon,
	SearchIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table"
import type { DashboardAlert } from "~/lib/dashboard-stats"
import { cn } from "~/lib/utils"
import type { DocStatus } from "../../generated/prisma/client"

export type Greeting = "morning" | "afternoon" | "evening"

export type DashboardDocRow = {
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

type MaterialLine = { serviceCodeId: string; qty: number }

export type SendBackEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

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

export function hasOverage(doc: DashboardDocRow): boolean {
	const estimated = toLines(doc.estimatedMaterials)
	const taken = toLines(doc.materialsTaken)
	if (estimated.length === 0 || taken.length === 0) return false
	const estimatedMap = Object.fromEntries(
		estimated.map((e) => [e.serviceCodeId, e.qty]),
	)
	return taken.some((t) => t.qty > (estimatedMap[t.serviceCodeId] ?? 0))
}

export function hasQuantityDiscrepancy(doc: DashboardDocRow): boolean {
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

export function hasShortage(doc: DashboardDocRow): boolean {
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

export function latestSendBack(doc: DashboardDocRow): SendBackEntry | null {
	const raw = doc.sendBackHistory
	if (raw == null || !Array.isArray(raw)) return null
	const history = raw as SendBackEntry[]
	if (history.length === 0) return null
	return history[history.length - 1]
}

export type TileTone = "mint" | "purple" | "coral" | "danger" | "warn"

const TILE_TONE: Record<TileTone, { wrap: string; icon: string }> = {
	mint: {
		wrap: "bg-status-info-soft",
		icon: "text-primary",
	},
	purple: {
		wrap: "bg-job-dispatched-bg",
		icon: "text-job-dispatched-text",
	},
	coral: {
		wrap: "bg-status-warn-soft",
		icon: "text-status-warn",
	},
	danger: {
		wrap: "bg-status-danger-soft",
		icon: "text-status-danger",
	},
	warn: {
		wrap: "bg-status-warn-soft",
		icon: "text-status-warn",
	},
}

export function Hills() {
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none absolute inset-x-0 top-0 h-40 w-full text-primary/15 dark:text-primary/20"
			viewBox="0 0 1200 160"
			preserveAspectRatio="none"
		>
			<path
				fill="currentColor"
				d="M0 160 C180 70 320 110 480 90 C680 65 760 30 920 55 C1040 74 1120 50 1200 70 L1200 160 Z"
				opacity="0.55"
			/>
			<path
				fill="currentColor"
				d="M0 160 C220 100 400 130 560 105 C740 78 860 40 1020 80 C1100 98 1160 86 1200 92 L1200 160 Z"
				opacity="0.35"
			/>
		</svg>
	)
}

export function RoleGreeting({
	userName,
	greeting = "morning",
	todayIso,
}: {
	userName?: string
	greeting?: Greeting
	todayIso?: string
}) {
	const { t, i18n } = useTranslation()
	const firstName = userName?.trim().split(/\s+/)[0]
	const todayLabel = todayIso
		? new Date(todayIso).toLocaleDateString(i18n.language, {
				weekday: "long",
				month: "long",
				day: "numeric",
			})
		: null
	return (
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
				{t("dashboard.subtitle")}
			</p>
		</div>
	)
}

function useDashboardNavigate() {
	const location = useLocation()
	return (mutate: (params: URLSearchParams) => void) => {
		const params = new URLSearchParams(location.search)
		mutate(params)
		const query = params.toString()
		window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
	}
}

export function CompactSearchBar({
	selectedStatus = null,
	selectedJobType = null,
	searchFilter = "",
}: {
	selectedStatus?: string | null
	selectedJobType?: string | null
	searchFilter?: string
}) {
	const { t } = useTranslation()
	const location = useLocation()
	const navigateWith = useDashboardNavigate()
	const hasActiveFilters =
		!!selectedStatus || !!selectedJobType || !!searchFilter

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2">
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
					className="absolute top-2.5 left-3 size-4 text-muted-foreground"
				/>
				<Input
					name="search"
					type="search"
					placeholder={t("dashboard.filter.search_short")}
					defaultValue={searchFilter}
					className="h-9 w-44 rounded-full bg-card pl-9 shadow-xs sm:w-56"
				/>
			</form>
			{hasActiveFilters && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						window.location.href = location.pathname
					}}
					className="text-xs"
				>
					<HugeiconsIcon
						icon={RemoveIcon}
						strokeWidth={2}
						className="mr-1 size-3"
					/>
					{t("dashboard.filter.clear_all")}
				</Button>
			)}
		</div>
	)
}

export function CompactSelectFilters({
	jobTypeOptions = [],
	selectedStatus = null,
	selectedJobType = null,
}: {
	jobTypeOptions?: string[]
	selectedStatus?: string | null
	selectedJobType?: string | null
}) {
	const { t } = useTranslation()
	const navigateWith = useDashboardNavigate()
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Select
				value={selectedStatus || ""}
				onValueChange={(v) =>
					navigateWith((p) => {
						if (v) p.set("status", v)
						else p.delete("status")
					})
				}
			>
				<SelectTrigger className="w-full bg-card">
					<SelectValue placeholder={t("dashboard.filter.status_placeholder")} />
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
				value={selectedJobType || ""}
				onValueChange={(v) =>
					navigateWith((p) => {
						if (v) p.set("jobType", v)
						else p.delete("jobType")
					})
				}
				disabled={!(jobTypeOptions && jobTypeOptions.length > 0)}
			>
				<SelectTrigger className="w-full bg-card">
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
		</div>
	)
}

export function MintAlert({
	alert,
	href,
}: {
	alert: NonNullable<DashboardAlert>
	href?: string
}) {
	const { t } = useTranslation()
	const inner = (
		<>
			<HugeiconsIcon
				icon={Notification01Icon}
				strokeWidth={2}
				className="size-4 shrink-0 text-primary"
			/>
			<span className="min-w-0 flex-1">
				{t(alert.key, { count: alert.count })}
			</span>
			<HugeiconsIcon
				icon={ChevronRightIcon}
				strokeWidth={2}
				className="size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
		</>
	)
	const className =
		"flex items-center gap-2 rounded-full bg-status-info-soft px-4 py-2.5 text-sm text-foreground"
	if (href) {
		return (
			<Link
				to={href}
				className={cn(
					className,
					"transition-colors hover:bg-status-info-soft/80",
				)}
			>
				{inner}
			</Link>
		)
	}
	return <div className={className}>{inner}</div>
}

export function MetricTile({
	icon,
	tone,
	title,
	value,
	detail,
	href,
}: {
	icon: IconSvgElement
	tone: TileTone
	title: string
	value: number
	detail: string
	href?: string
}) {
	const toneClass = TILE_TONE[tone]
	const inner = (
		<>
			<div className="flex min-w-0 items-start gap-3">
				<span
					className={cn(
						"flex size-10 shrink-0 items-center justify-center rounded-full",
						toneClass.wrap,
					)}
				>
					<HugeiconsIcon
						icon={icon}
						strokeWidth={1.75}
						className={cn("size-5", toneClass.icon)}
					/>
				</span>
				<div className="min-w-0">
					<div className="text-sm leading-snug font-medium text-foreground">
						{title}
					</div>
					<div className="mt-0.5 text-2xl leading-tight font-semibold tracking-tight">
						{value}
					</div>
					<div className="mt-0.5 text-xs leading-snug text-muted-foreground">
						{detail}
					</div>
				</div>
			</div>
			<HugeiconsIcon
				icon={ChevronRightIcon}
				strokeWidth={2}
				className="size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
		</>
	)
	const className =
		"flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-4 shadow-xs transition-colors"
	if (href) {
		return (
			<Link
				to={href}
				className={cn(className, "hover:border-primary/30 hover:bg-accent/40")}
			>
				{inner}
			</Link>
		)
	}
	return <div className={className}>{inner}</div>
}

export function QueueCard({
	id,
	title,
	badge,
	variant,
	children,
}: {
	id: string
	title: string
	badge: number
	variant: "warn" | "danger" | "info"
	children: ReactNode
}) {
	return (
		<section
			id={id}
			className="min-w-0 scroll-mt-20 rounded-2xl border border-border bg-card p-5 shadow-xs"
		>
			<div className="mb-3 flex items-start justify-between gap-3">
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				<Badge variant={variant}>{badge}</Badge>
			</div>
			{children}
		</section>
	)
}

export function DocRowLink({
	to,
	controlNumber,
	meta,
}: {
	to: string
	controlNumber: string
	meta: ReactNode
}) {
	return (
		<Link
			to={to}
			className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-mono font-medium">{controlNumber}</span>
				<HugeiconsIcon
					icon={ChevronRightIcon}
					strokeWidth={2}
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			</div>
			{meta}
		</Link>
	)
}

export function RecentDocumentsTable({ docs }: { docs: DashboardDocRow[] }) {
	const { t, i18n } = useTranslation()
	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
			<div className="flex items-start justify-between gap-3 px-5 py-4">
				<div className="flex min-w-0 items-start gap-3">
					<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-info-soft text-primary">
						<HugeiconsIcon
							icon={File01Icon}
							strokeWidth={1.75}
							className="size-5"
						/>
					</span>
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">
							{t("dashboard.recent_documents")}
						</h2>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{t("dashboard.recent_documents_sub")}
						</p>
					</div>
				</div>
				<Link
					to="/dashboard"
					className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted"
				>
					{t("dashboard.recent_view_all")}
					<HugeiconsIcon
						icon={ChevronRightIcon}
						strokeWidth={2}
						className="size-3.5"
						aria-hidden="true"
					/>
				</Link>
			</div>
			<Table>
				<TableHeader className="bg-muted/70">
					<TableRow>
						<TableHead>{t("dashboard.col.doc")}</TableHead>
						<TableHead>{t("dashboard.col.type")}</TableHead>
						<TableHead>{t("dashboard.col.status")}</TableHead>
						<TableHead>{t("dashboard.col.created")}</TableHead>
						<TableHead className="w-14 text-right">
							{t("dashboard.col.action")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{docs.length === 0 && (
						<TableEmptyRow colSpan={5}>
							<EmptyState title={t("dashboard.no_documents")} />
						</TableEmptyRow>
					)}
					{docs.map((doc) => {
						const overage = hasOverage(doc)
						const discrepancy = hasQuantityDiscrepancy(doc)
						const shortage = hasShortage(doc)
						return (
							<TableRow key={doc.id} className="h-auto">
								<TableCell className="py-3">
									<Link
										to={`/docs/${doc.id}`}
										className="block hover:underline"
									>
										<span className="font-mono text-sm font-medium">
											{doc.controlNumber}
										</span>
										<span className="mt-0.5 block truncate text-xs text-muted-foreground">
											{doc.jobAddressEstimated}
										</span>
									</Link>
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
								</TableCell>
								<TableCell>
									<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
										<HugeiconsIcon
											icon={File01Icon}
											strokeWidth={2}
											className="size-3.5 shrink-0"
											aria-hidden="true"
										/>
										{doc.jobType}
									</span>
								</TableCell>
								<TableCell>
									<Badge variant={STATUS_BADGE_VARIANT[doc.status]} dot>
										{t(STATUS_LABEL_KEY[doc.status])}
									</Badge>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{doc.createdAt
										? doc.createdAt.toLocaleDateString(i18n.language, {
												month: "short",
												day: "numeric",
												year: "numeric",
											})
										: null}
								</TableCell>
								<TableCell className="text-right">
									<Link
										to={`/docs/${doc.id}`}
										aria-label={doc.controlNumber}
										className="inline-flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
									>
										<HugeiconsIcon
											icon={ChevronRightIcon}
											strokeWidth={2}
											className="size-4"
										/>
									</Link>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</section>
	)
}

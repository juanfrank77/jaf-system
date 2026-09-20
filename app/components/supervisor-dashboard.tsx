import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { Greeting } from "~/components/dashboard-view"
import { Badge } from "~/components/ui/badge"
import { Card, CardHeader, CardTitle } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { PageHeader } from "~/components/ui/page-header"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table"
import type { SupervisorStage } from "~/lib/supervisor-stage"
import { formatMoney } from "~/lib/utils"

type QueueRow = {
	id: string
	controlNumber: string
	jobAddressEstimated: string
	jobAddressActual: string | null
	brigadeName: string | null
	stage: SupervisorStage
	amount: number | null
	note?: string | null
}
type Queues = {
	pendingReview: QueueRow[]
	sentBack: QueueRow[]
	missingAviso: QueueRow[]
	blocked: QueueRow[]
}

const STAGE_KEY: Record<SupervisorStage, ParseKeys> = {
	INTAKE: "step_rail.intake",
	WAREHOUSE: "step_rail.warehouse",
	FIELD: "step_rail.field",
	APPROVE: "step_rail.approve",
	INVOICE: "step_rail.invoice",
	AVISO: "step_rail.aviso",
	PRECERT: "step_rail.precert",
	RELEASE: "step_rail.release",
	RELEASED: "step_rail.released",
}

function Queue({
	titleKey,
	rows,
	variant,
	href,
}: {
	titleKey: ParseKeys
	rows: QueueRow[]
	variant: "warn" | "danger" | "info"
	href: (r: QueueRow) => string
}) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{t(titleKey)}
					<Badge variant={variant}>{rows.length}</Badge>
				</CardTitle>
			</CardHeader>
			{rows.length === 0 ? (
				<EmptyState title={t("dashboard.queue.empty")} />
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("dashboard.col.work_order")}</TableHead>
							<TableHead>{t("dashboard.col.address")}</TableHead>
							<TableHead>{t("dashboard.col.crew")}</TableHead>
							<TableHead>{t("dashboard.col.stage")}</TableHead>
							<TableHead className="text-right">
								{t("dashboard.col.jaf_invoice")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((r) => (
							<TableRow key={r.id}>
								<TableCell className="font-mono text-xs">
									<Link
										to={href(r)}
										className="text-foreground hover:underline"
									>
										{r.controlNumber}
									</Link>
								</TableCell>
								<TableCell className="max-w-[16rem] truncate">
									{r.jobAddressActual ?? r.jobAddressEstimated}
								</TableCell>
								<TableCell>{r.brigadeName ?? "—"}</TableCell>
								<TableCell>
									{t(STAGE_KEY[r.stage])}
									{r.note ? (
										<span className="block text-xs text-status-warn">
											{r.note}
										</span>
									) : null}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{r.amount == null ? "—" : formatMoney(r.amount)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</Card>
	)
}

const GREETING_KEY: Record<Greeting, ParseKeys> = {
	morning: "dashboard.greeting.morning",
	afternoon: "dashboard.greeting.afternoon",
	evening: "dashboard.greeting.evening",
}

export function SupervisorDashboard({
	queues,
	userName,
	greeting = "morning",
	todayIso,
}: {
	queues: Queues
	userName?: string
	greeting?: Greeting
	todayIso?: string
}) {
	const { t, i18n } = useTranslation()
	const firstName = userName?.trim().split(/\s+/)[0]
	const todayLabel = todayIso
		? new Date(todayIso).toLocaleDateString(i18n.language, {
				weekday: "long",
				day: "numeric",
				month: "long",
			})
		: null
	return (
		<div>
			<PageHeader
				title={
					firstName
						? t(GREETING_KEY[greeting], {
								name: firstName,
								interpolation: { escapeValue: false },
							})
						: t("dashboard.title")
				}
				subtitle={t("dashboard.subtitle")}
				meta={
					todayLabel ? (
						<span className="text-sm text-muted-foreground capitalize">
							{todayLabel}
						</span>
					) : undefined
				}
			/>
			<div className="space-y-4">
				<Queue
					titleKey="dashboard.queue.pending_review"
					rows={queues.pendingReview}
					variant="warn"
					href={(r) => `/docs/${r.id}/review`}
				/>
				<Queue
					titleKey="dashboard.queue.sent_back"
					rows={queues.sentBack}
					variant="info"
					href={(r) => `/docs/${r.id}`}
				/>
				<Queue
					titleKey="dashboard.queue.missing_aviso"
					rows={queues.missingAviso}
					variant="warn"
					href={(r) => `/docs/${r.id}/review`}
				/>
				<Queue
					titleKey="dashboard.queue.blocked"
					rows={queues.blocked}
					variant="danger"
					href={(r) => `/docs/${r.id}/review`}
				/>
			</div>
		</div>
	)
}

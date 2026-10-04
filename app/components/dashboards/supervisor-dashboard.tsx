import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { PageHeader } from "~/components/ui/page-header"
import { QueueCard } from "~/components/ui/queue-card"
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
export type SupervisorQueues = {
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
		<QueueCard
			title={t(titleKey)}
			count={rows.length}
			variant={variant}
			empty={t("dashboard.queue.empty")}
		>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-xs text-muted-foreground text-left border-b">
						<th className="py-1">{t("dashboard.col.work_order")}</th>
						<th className="py-1">{t("dashboard.col.address")}</th>
						<th className="py-1">{t("dashboard.col.crew")}</th>
						<th className="py-1">{t("dashboard.col.stage")}</th>
						<th className="py-1 text-right">
							{t("dashboard.col.jaf_invoice")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
							<td className="py-1.5 font-mono">
								<Link to={href(r)} className="underline">
									{r.controlNumber}
								</Link>
							</td>
							<td className="py-1.5 truncate max-w-[16rem]">
								{r.jobAddressActual ?? r.jobAddressEstimated}
							</td>
							<td className="py-1.5">{r.brigadeName ?? "—"}</td>
							<td className="py-1.5">
								{t(STAGE_KEY[r.stage])}
								{r.note ? (
									<span className="block text-xs text-status-warn">
										{r.note}
									</span>
								) : null}
							</td>
							<td className="py-1.5 text-right">
								{r.amount == null ? "—" : formatMoney(r.amount)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</QueueCard>
	)
}

export function SupervisorDashboard({ queues }: { queues: SupervisorQueues }) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t("dashboard.title")} />
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
	)
}

import { ChevronRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { DashboardDocRow } from "~/components/dashboard-doc-list"
import { JobFlowOverview } from "~/components/job-step-rail"
import { Badge } from "~/components/ui/badge"
import { Callout } from "~/components/ui/callout"
import { EmptyState } from "~/components/ui/empty-state"
import {
	CREW_QUEUE_KINDS,
	CREW_QUEUE_LABEL_KEY,
	type CrewQueue,
} from "~/lib/crew-queues"
import type {
	BaseDashboardProps,
	CrewOnlyKeys,
	DashboardViewProps,
} from "./types"

type CrewRowKind = "sent_back" | "ready" | "on_site" | "submitted" | "approved"

const BADGE: Record<CrewRowKind, "warn" | "info" | "ok" | "danger"> = {
	sent_back: "danger",
	ready: "info",
	on_site: "warn",
	submitted: "info",
	approved: "ok",
}

const APPROVED_STATUSES = new Set(["SUPERVISOR_APPROVED", "CLARO_UPLOADED"])
const MAX_APPROVED = 5

function latestNote(doc: DashboardDocRow): string | null {
	const history = doc.sendBackHistory
	if (!Array.isArray(history) || history.length === 0) return null
	const last = history[history.length - 1] as { note?: unknown }
	return typeof last?.note === "string" ? last.note : null
}

function hrefFor(kind: CrewRowKind, id: string): string {
	if (kind === "ready") return `/docs/${id}/sign`
	if (kind === "on_site" || kind === "sent_back") return `/docs/${id}/field`
	return `/docs/${id}`
}

/** The crew's "My jobs": one flat list, no stat tiles, no billing. Needs
 * attention first (sent back), then pickup, on site, submitted, approved. */
export function CrewDashboard(
	props: BaseDashboardProps &
		Pick<DashboardViewProps, CrewOnlyKeys> & { queue?: CrewQueue | null },
) {
	const { t } = useTranslation()
	const {
		crewSentBackDocs = [],
		crewPreppedDocs = [],
		crewInFieldDocs = [],
		crewSubmittedDocs = [],
		docs,
		queue = null,
	} = props
	const approved = useMemo(
		() =>
			docs
				.filter((d) => APPROVED_STATUSES.has(d.status))
				.slice(0, MAX_APPROVED),
		[docs],
	)
	const allRows = useMemo(
		() => [
			...crewSentBackDocs.map((doc) => ({ kind: "sent_back" as const, doc })),
			...crewPreppedDocs.map((doc) => ({ kind: "ready" as const, doc })),
			...crewInFieldDocs.map((doc) => ({ kind: "on_site" as const, doc })),
			...crewSubmittedDocs.map((doc) => ({ kind: "submitted" as const, doc })),
			...approved.map((doc) => ({ kind: "approved" as const, doc })),
		],
		[
			crewSentBackDocs,
			crewPreppedDocs,
			crewInFieldDocs,
			crewSubmittedDocs,
			approved,
		],
	)
	// A sidebar queue narrows the list to its own steps; the plain dashboard
	// keeps every row, approved included.
	const rows = useMemo(
		() =>
			queue
				? allRows.filter(({ kind }) =>
						(CREW_QUEUE_KINDS[queue] as readonly string[]).includes(kind),
					)
				: allRows,
		[allRows, queue],
	)
	const open = rows.filter(({ kind }) => kind !== "approved").length

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-xl font-semibold">
					{queue ? t(CREW_QUEUE_LABEL_KEY[queue]) : t("dashboard.crew.title")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t("dashboard.crew.subtitle_open", { count: open })}
				</p>
			</div>
			<JobFlowOverview viewer="CREW" compact />
			<Callout title={t("job_flow.callout.crew_list_title")}>
				{t("job_flow.callout.crew_list_body")}
			</Callout>
			{rows.length === 0 && (
				<EmptyState>{t("dashboard.crew.empty")}</EmptyState>
			)}
			<ul className="space-y-2">
				{rows.map(({ kind, doc }) => {
					const note = kind === "sent_back" ? latestNote(doc) : null
					return (
						<li key={doc.id}>
							<Link
								to={hrefFor(kind, doc.id)}
								className={`flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors hover:bg-muted/40 ${
									kind === "sent_back"
										? "border-status-danger/50"
										: "border-border"
								} ${kind === "approved" ? "opacity-75" : ""}`}
							>
								<div className="min-w-0 flex-1">
									<p className="font-mono text-sm font-semibold">
										{doc.controlNumber}
									</p>
									<p className="truncate text-sm">{doc.jobType}</p>
									<p className="truncate text-xs text-muted-foreground">
										{doc.jobAddressEstimated}
									</p>
									{note && (
										<p className="mt-1 text-xs font-medium text-status-danger">
											{t("dashboard.crew.sent_back_note", { note })}
										</p>
									)}
								</div>
								<Badge variant={BADGE[kind]} className="shrink-0">
									{t(`dashboard.crew.status.${kind}`)}
								</Badge>
								<HugeiconsIcon
									icon={ChevronRightIcon}
									strokeWidth={2}
									className="size-4 shrink-0 text-muted-foreground"
								/>
							</Link>
						</li>
					)
				})}
			</ul>
		</div>
	)
}

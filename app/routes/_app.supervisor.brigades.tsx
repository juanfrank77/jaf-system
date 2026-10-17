import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { STAGE_KEY } from "~/components/dashboards/supervisor-dashboard"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { EmptyState } from "~/components/ui/empty-state"
import { PageHeader } from "~/components/ui/page-header"
import { assignedBrigadeIds } from "~/lib/crew-assignment"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { supervisorAreas } from "~/lib/supervisor-scope"
import {
	deriveSupervisorStage,
	type SupervisorStage,
} from "~/lib/supervisor-stage"
import type { Route } from "./+types/_app.supervisor.brigades"

export const meta: Route.MetaFunction = () => [{ title: "Brigades — JAF Ops" }]

/** The statuses where a brigade still has work to do on a job: from created
 * through the field update. After that the job is the supervisor's to approve. */
const BRIGADE_WORK_STATUSES = [
	"CREATED",
	"PREPPED",
	"SIGNED",
	"FIELD_UPDATED",
] as const

/**
 * "Where my brigades are": a read-only view of the supervisor's active
 * brigades and the jobs each is working. Adding, editing and deactivating
 * brigades belongs to the Comptroller (`/comptroller/brigades`).
 */
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR"])
	const areas = await supervisorAreas(db, user.id)

	const brigades = await db.brigade.findMany({
		where: { active: true, area: { in: areas } },
		orderBy: { name: "asc" },
	})
	const memberIds = [...new Set(brigades.flatMap((b) => b.memberIds))]
	const brigadeIds = brigades.map((b) => b.id)

	const [crewUsers, jobs] = await Promise.all([
		db.user.findMany({
			where: { id: { in: memberIds } },
			select: { id: true, name: true },
		}),
		brigades.length === 0
			? []
			: db.jafInvoice.findMany({
					where: {
						status: { in: [...BRIGADE_WORK_STATUSES] },
						// A job can be shared by several brigades; the lead is
						// `brigadeId`, the rest only appear in the assignment
						// history, so match on the crew as well.
						OR: [
							{ brigadeId: { in: brigadeIds } },
							{ assignedCrewIds: { hasSome: memberIds } },
						],
					},
					select: {
						id: true,
						controlNumber: true,
						status: true,
						jobAddressEstimated: true,
						jobAddressActual: true,
						brigadeId: true,
						crewAssignmentHistory: true,
						supervisorApprovedAt: true,
						jafInvoiceGeneratedAt: true,
						avisoMatchedAt: true,
						releasedToFinanceAt: true,
					},
					orderBy: { createdAt: "desc" },
				}),
	])

	const names = new Map(crewUsers.map((u) => [u.id, u.name]))
	return {
		brigades: brigades.map((b) => ({
			id: b.id,
			name: b.name,
			area: b.area,
			members: b.memberIds
				.map((id) => names.get(id))
				.filter(Boolean) as string[],
			jobs: jobs
				.filter((j) => assignedBrigadeIds(j).includes(b.id))
				.map((j) => ({
					id: j.id,
					controlNumber: j.controlNumber,
					address: j.jobAddressActual ?? j.jobAddressEstimated,
					stage: deriveSupervisorStage(j, null) as SupervisorStage,
				})),
		})),
	}
}

export default function SupervisorBrigades({
	loaderData,
}: Route.ComponentProps) {
	const { brigades } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader
				title={t("supervisor_brigades.title")}
				description={t("supervisor_brigades.description")}
			/>
			{brigades.length === 0 && (
				<EmptyState>{t("supervisor_brigades.empty")}</EmptyState>
			)}
			<div className="grid gap-3 md:grid-cols-2">
				{brigades.map((b) => (
					<section
						key={b.id}
						className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-card"
					>
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<h2 className="text-sm font-semibold">{b.name}</h2>
								<p className="text-xs text-muted-foreground">
									{[b.area, b.members.join(", ")].filter(Boolean).join(" · ") ||
										t("supervisor_brigades.no_members")}
								</p>
							</div>
							<Badge variant={b.jobs.length > 0 ? "info" : "ok"}>
								{b.jobs.length > 0
									? t("supervisor_brigades.jobs", { count: b.jobs.length })
									: t("supervisor_brigades.available")}
							</Badge>
						</div>
						{b.jobs.length > 0 && (
							<ul className="divide-y divide-border text-sm">
								{b.jobs.map((j) => (
									<li
										key={j.id}
										className="flex items-center justify-between gap-3 py-1.5"
									>
										<div className="min-w-0">
											<Link
												to={`/docs/${j.id}`}
												className="font-mono underline"
											>
												{j.controlNumber}
											</Link>
											<p className="truncate text-xs text-muted-foreground">
												{j.address}
											</p>
										</div>
										<span className="shrink-0 text-xs text-muted-foreground">
											{t(STAGE_KEY[j.stage])}
										</span>
									</li>
								))}
							</ul>
						)}
					</section>
				))}
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

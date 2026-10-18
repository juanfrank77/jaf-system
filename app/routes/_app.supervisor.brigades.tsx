import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { STAGE_KEY } from "~/components/dashboards/supervisor-dashboard"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import {
	DataTable,
	DataTableHead,
	Td,
	Th,
	Tr,
} from "~/components/ui/data-table"
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
 * brigades: the idle ones, and one row per job in progress with the brigades
 * on it. Adding, editing and deactivating brigades belongs to the
 * Comptroller (`/comptroller/brigades`).
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

	const jobRows =
		brigades.length === 0
			? []
			: await db.jafInvoice.findMany({
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
				})

	const nameById = new Map(brigades.map((b) => [b.id, b.name]))
	// One row per job, however many brigades share it; only this supervisor's
	// brigades are named.
	const busy = new Set<string>()
	const jobs = jobRows.flatMap((j) => {
		const ids = assignedBrigadeIds(j).filter((id) => nameById.has(id))
		if (ids.length === 0) return []
		for (const id of ids) busy.add(id)
		return {
			id: j.id,
			controlNumber: j.controlNumber,
			address: j.jobAddressActual ?? j.jobAddressEstimated,
			stage: deriveSupervisorStage(j, null) as SupervisorStage,
			brigades: ids.map((id) => nameById.get(id) as string),
		}
	})
	return {
		jobs,
		available: brigades
			.filter((b) => !busy.has(b.id))
			.map((b) => ({ id: b.id, name: b.name, area: b.area })),
		brigadeCount: brigades.length,
	}
}

export default function SupervisorBrigades({
	loaderData,
}: Route.ComponentProps) {
	const { jobs, available, brigadeCount } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader
				title={t("supervisor_brigades.title")}
				description={t("supervisor_brigades.description")}
			/>
			{brigadeCount === 0 && (
				<EmptyState>{t("supervisor_brigades.empty")}</EmptyState>
			)}
			{available.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-semibold">
						{t("supervisor_brigades.available_heading")}
					</h2>
					<ul className="flex flex-wrap gap-2">
						{available.map((b) => (
							<li key={b.id}>
								<Badge variant="ok">
									{b.name}
									{b.area ? ` · ${b.area}` : ""}
								</Badge>
							</li>
						))}
					</ul>
				</section>
			)}
			{brigadeCount > 0 && jobs.length === 0 && (
				<EmptyState>{t("supervisor_brigades.no_jobs")}</EmptyState>
			)}
			{jobs.length > 0 && (
				<DataTable>
					<DataTableHead>
						<Th>{t("supervisor_brigades.col_job")}</Th>
						<Th className="hidden md:table-cell">
							{t("supervisor_brigades.col_address")}
						</Th>
						<Th>{t("supervisor_brigades.col_step")}</Th>
						<Th>{t("supervisor_brigades.col_brigade")}</Th>
					</DataTableHead>
					<tbody>
						{jobs.map((j) => (
							<Tr key={j.id}>
								<Td>
									<Link to={`/docs/${j.id}`} className="font-mono underline">
										{j.controlNumber}
									</Link>
									<p className="text-xs text-muted-foreground md:hidden">
										{j.address}
									</p>
								</Td>
								<Td className="hidden text-muted-foreground md:table-cell">
									{j.address}
								</Td>
								<Td>{t(STAGE_KEY[j.stage])}</Td>
								<Td>{j.brigades.join(", ")}</Td>
							</Tr>
						))}
					</tbody>
				</DataTable>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

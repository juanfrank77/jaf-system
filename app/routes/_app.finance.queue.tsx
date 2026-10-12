import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Callout } from "~/components/ui/callout"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { loadStageRows } from "~/lib/finance-stage-rows.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [
	{ title: "Packets in — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const { rows, totalCount } = await loadStageRows({
		stage: "PACKETS",
		page,
		pageSize: PAGE_SIZE,
		ageFrom: "released",
	})
	return {
		user,
		jobs: rows,
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export default function FinancePackets({ loaderData }: Route.ComponentProps) {
	const { jobs, pagination } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.packets")}
				</h1>
				<StageChip arm="A" step={1} total={5} />
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.packets_title")}>
				{t("finance_flow.callout.packets_body")}
			</Callout>
			{jobs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<FinanceStageTable
					rows={jobs}
					to={(r) => `/finance/verify/${r.id}`}
					showDocs
					ageLabelKey="finance_stage.age.packets"
					action={(r) => (
						<Link to={`/finance/verify/${r.id}`} className="underline">
							{Object.values(r.docs).every(Boolean)
								? t("finance_stage.accept")
								: t("finance_stage.review")}
						</Link>
					)}
				/>
			)}
			<StagePagination
				basePath="/finance/queue"
				pagination={pagination}
				pageSize={PAGE_SIZE}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

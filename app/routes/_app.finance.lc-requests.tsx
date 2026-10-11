import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Callout } from "~/components/ui/callout"
import { loadStageRows, PAGE_SIZE } from "~/lib/finance-stage-rows.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.lc-requests"

export const meta: Route.MetaFunction = () => [
	{ title: "LC request — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const { rows, totalCount } = await loadStageRows({
		stage: "LC_REQUEST",
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

export default function FinanceLcRequests({
	loaderData,
}: Route.ComponentProps) {
	const { jobs, pagination } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lc_request")}
				</h1>
				<StageChip arm="A" step={2} total={5} />
			</div>
			<FinanceStepRail current="LC_REQUEST" />
			<Callout title={t("finance_flow.callout.lc_request_title")}>
				{t("finance_flow.callout.lc_request_body")}
			</Callout>
			{jobs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<FinanceStageTable
					rows={jobs}
					to={(r) => `/finance/pbcc/${r.id}`}
					ageLabelKey="finance_stage.age.packets"
					action={(r) => (
						<Link to={`/finance/pbcc/${r.id}`} className="underline">
							{t("finance_stage.build_request")}
						</Link>
					)}
				/>
			)}
			<StagePagination
				basePath="/finance/lc-requests"
				pagination={pagination}
				pageSize={PAGE_SIZE}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

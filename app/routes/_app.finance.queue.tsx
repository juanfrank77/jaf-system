import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { loadStageRows } from "~/lib/finance-stage-rows.server"
import { stageWhere } from "~/lib/finance-stages.server"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [{ title: "Inbox — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const search = url.searchParams.get("search")?.trim() ?? ""
	const supervisorId = url.searchParams.get("supervisor") ?? ""
	const stage = {
		stage: "PACKETS",
		pageSize: PAGE_SIZE,
		ageFrom: "released",
		search,
		supervisorId: supervisorId || undefined,
	} as const
	const [{ rows, totalCount }, oldest, supervisors] = await Promise.all([
		loadStageRows({ ...stage, page }),
		// Oldest packet under the current filters: where Start reviewing goes.
		page === 1
			? null
			: loadStageRows({ ...stage, page: 1, pageSize: 1 }).then(
					(r) => r.rows[0],
				),
		db.user.findMany({
			where: { supervisedInvoices: { some: stageWhere("PACKETS") } },
			orderBy: { name: "asc" },
			select: { id: true, name: true },
		}),
	])
	return {
		user,
		jobs: rows,
		search,
		supervisorId,
		supervisors,
		startId: (oldest ?? rows[0])?.id ?? null,
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export default function FinancePackets({ loaderData }: Route.ComponentProps) {
	const { jobs, pagination, search, supervisorId, supervisors, startId } =
		loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.packets")}
				</h1>
				<StageChip arm="A" step={1} total={FINANCE_STEPS.length} />
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.packets_title")}>
				{t("finance_flow.callout.packets_body")}
			</Callout>
			<div className="flex flex-wrap items-end gap-3">
				<Form method="get" className="flex flex-1 flex-wrap items-end gap-2">
					<Input
						name="search"
						defaultValue={search}
						placeholder={t("finance_queue.search_placeholder")}
						aria-label={t("finance_queue.search_placeholder")}
						className="max-w-xs"
					/>
					<select
						name="supervisor"
						defaultValue={supervisorId}
						aria-label={t("finance_queue.supervisor_filter")}
						className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
					>
						<option value="">{t("finance_queue.all_supervisors")}</option>
						{supervisors.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
					<Button type="submit" variant="outline">
						{t("finance_queue.filter")}
					</Button>
				</Form>
				{startId && (
					<Link
						to={`/finance/verify/${startId}`}
						className={buttonVariants({})}
					>
						{t("finance_queue.start_reviewing")}
					</Link>
				)}
			</div>
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
				params={{
					...(search && { search }),
					...(supervisorId && { supervisor: supervisorId }),
				}}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

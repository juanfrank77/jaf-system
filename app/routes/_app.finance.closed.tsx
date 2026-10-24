import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { StagePagination } from "~/components/finance-stage-table"
import { FinanceStepRail } from "~/components/finance-step-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Input } from "~/components/ui/input"
import { loadClosedAvisos } from "~/lib/closed-avisos.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.closed"

export const meta: Route.MetaFunction = () => [{ title: "Closed — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const search = url.searchParams.get("search")?.trim() ?? ""
	const { rows, totalCount } = await loadClosedAvisos({ page, search })
	return {
		user,
		rows,
		search,
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export default function FinanceClosed({ loaderData }: Route.ComponentProps) {
	const { rows, search, pagination } = loaderData
	const { t } = useTranslation()
	const date = (iso: string | null) => (iso ? formatShortDate(iso) : "—")
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("finance_closed.title")}</h1>
			<FinanceStepRail current="CLOSED" />
			<Callout title={t("finance_closed.callout_title")}>
				{t("finance_closed.callout_body")}
			</Callout>
			<Form method="get" className="flex flex-wrap items-end gap-2">
				<Input
					name="search"
					defaultValue={search}
					placeholder={t("finance_queue.search_placeholder")}
					aria-label={t("finance_queue.search_placeholder")}
					className="max-w-xs"
				/>
				<Button type="submit" variant="outline">
					{t("finance_queue.filter")}
				</Button>
			</Form>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_closed.empty")}
				</p>
			) : (
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="p-2">{t("finance_stage.col.work_order")}</th>
								<th className="p-2">{t("finance_stage.col.aviso")}</th>
								<th className="p-2">{t("finance_payroll.col.brigade")}</th>
								<th className="p-2">{t("finance_closed.col.sold")}</th>
								<th className="p-2">{t("finance_closed.col.request_sent")}</th>
								<th className="p-2">{t("finance_closed.col.paid")}</th>
								<th className="p-2 text-right">
									{t("finance_closed.col.days")}
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id} className="border-b last:border-0">
									<td className="p-2 font-mono">
										<Link to={`/finance/pbcc/${r.id}`} className="underline">
											{r.controlNumber}
										</Link>
									</td>
									<td className="p-2">{r.avisoNumber ?? "—"}</td>
									<td className="p-2">{r.brigade || "—"}</td>
									<td className="p-2">{date(r.soldToPbccAt)}</td>
									<td className="p-2">{date(r.requestSentAt)}</td>
									<td className="p-2">{date(r.brigadePaidAt)}</td>
									<td className="p-2 text-right font-mono">
										{r.daysSoldToPaid ?? "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<StagePagination
				basePath="/finance/closed"
				pagination={pagination}
				pageSize={PAGE_SIZE}
				params={search ? { search } : {}}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

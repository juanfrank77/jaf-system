import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent } from "~/components/ui/card"
import { listProgress } from "~/lib/comptroller-lists"
import { loadComptrollerRuns } from "~/lib/comptroller-runs.server"
import { requireRole } from "~/lib/permissions.server"
import { cn, formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.lists"

export const meta: Route.MetaFunction = () => [
	{ title: "Lists from Lissette — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const { all } = await loadComptrollerRuns()
	return {
		lists: all.map((run) => ({
			id: run.id,
			label: run.label,
			generatedAt: run.generatedAt,
			invoiceCount: run.invoices.length,
			total: run.toPayTotal,
			...listProgress(run, run.accounts),
		})),
	}
}

export default function ComptrollerLists({ loaderData }: Route.ComponentProps) {
	const { lists } = loaderData
	const { t } = useTranslation()
	return (
		<div className="p-6 space-y-4">
			<h1 className="text-2xl font-bold">{t("comptroller_lists.title")}</h1>
			<Callout title={t("comptroller_payroll.callout_title")}>
				{t("comptroller_lists.callout_body")}
			</Callout>
			<Card>
				<CardContent className="p-0">
					{lists.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("comptroller_payroll.empty")}
						</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="p-2">{t("comptroller_lists.col.list")}</th>
									<th className="p-2">{t("comptroller_lists.col.sent")}</th>
									<th className="p-2">
										{t("comptroller_lists.col.work_orders")}
									</th>
									<th className="p-2 text-right">
										{t("comptroller_lists.col.total")}
									</th>
									<th className="p-2">{t("comptroller_lists.col.status")}</th>
									<th className="p-2" />
								</tr>
							</thead>
							<tbody>
								{lists.map((l) => (
									<tr
										key={l.id}
										data-testid="comptroller-list-row"
										className={cn(
											"border-b last:border-0",
											!l.open && "text-muted-foreground opacity-60",
										)}
									>
										<td className="p-2 font-medium">{l.label}</td>
										<td className="p-2">
											{new Date(l.generatedAt).toLocaleDateString()}
										</td>
										<td className="p-2">{l.invoiceCount}</td>
										<td className="p-2 text-right">{formatMoney(l.total)}</td>
										<td className="p-2">
											{l.open
												? t("comptroller_lists.status_unpaid", {
														unpaid: l.unpaid,
														total: l.accountCount,
													})
												: t("comptroller_lists.status_paid")}
										</td>
										<td className="p-2 text-right">
											<Link
												to={`/comptroller/runs/${l.id}`}
												className="underline font-medium"
											>
												{l.open
													? t("comptroller_lists.open")
													: t("comptroller_lists.view")}
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

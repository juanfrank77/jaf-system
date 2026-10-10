import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller"

export const meta: Route.MetaFunction = () => [
	{ title: "Brigades · payroll — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const runs = await db.payrollRun.findMany({
		where: { reversedAt: null },
		orderBy: { generatedAt: "desc" },
		take: 50,
		select: {
			id: true,
			label: true,
			generatedAt: true,
			paidAt: true,
			accounts: { select: { paidAt: true, confirmedByFallback: true } },
		},
	})
	return {
		user,
		toPay: runs.filter((r) => !r.paidAt).reverse(), // oldest first
		paid: runs.filter((r) => r.paidAt),
	}
}

type RunRow = Route.ComponentProps["loaderData"]["toPay"][number]

function RunsTable({ runs }: { runs: RunRow[] }) {
	const { t } = useTranslation()
	if (runs.length === 0) {
		return (
			<p className="p-4 text-sm text-muted-foreground">
				{t("comptroller_payroll.empty")}
			</p>
		)
	}
	return (
		<table className="w-full text-sm">
			<tbody>
				{runs.map((run) => {
					const paid = run.accounts.filter((a) => a.paidAt).length
					const fromPaper = run.accounts.filter(
						(a) => a.confirmedByFallback,
					).length
					return (
						<tr key={run.id} className="border-b last:border-0">
							<td className="p-2">
								<Link
									to={`/comptroller/runs/${run.id}`}
									className="underline font-medium"
								>
									{run.label}
								</Link>
							</td>
							<td className="p-2 text-muted-foreground">
								{new Date(run.generatedAt).toLocaleDateString()}
							</td>
							<td className="p-2">
								<span className="flex flex-wrap items-center gap-2">
									<span>
										{t("comptroller_payroll.accounts_progress", {
											paid,
											total: run.accounts.length,
										})}
									</span>
									{fromPaper > 0 && (
										<Badge variant="warn">
											{t("finance_payroll.fallback_count", {
												count: fromPaper,
											})}
										</Badge>
									)}
								</span>
							</td>
						</tr>
					)
				})}
			</tbody>
		</table>
	)
}

export default function ComptrollerPayroll({
	loaderData,
}: Route.ComponentProps) {
	const { toPay, paid } = loaderData
	const { t } = useTranslation()
	return (
		<div className="p-6 space-y-4">
			<h1 className="text-2xl font-bold">{t("comptroller_payroll.title")}</h1>
			<Callout title={t("comptroller_payroll.callout_title")}>
				{t("comptroller_payroll.callout_body")}
			</Callout>
			<Card>
				<CardContent className="p-0">
					<h2 className="p-3 text-sm font-semibold border-b">
						{t("comptroller_payroll.runs_to_pay")}
					</h2>
					<RunsTable runs={toPay} />
				</CardContent>
			</Card>
			<Card>
				<CardContent className="p-0">
					<h2 className="p-3 text-sm font-semibold border-b">
						{t("comptroller_payroll.paid_runs")}
					</h2>
					<RunsTable runs={paid} />
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

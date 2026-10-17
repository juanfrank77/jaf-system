import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"

export type ComptrollerRunRow = {
	id: string
	label: string
	generatedAt: Date | string
	accounts: { paidAt: Date | string | null; confirmedByFallback: boolean }[]
}

export function ComptrollerRunsTable({ runs }: { runs: ComptrollerRunRow[] }) {
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

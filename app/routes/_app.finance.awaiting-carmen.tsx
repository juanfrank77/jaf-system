import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { isPayrollFallbackEnabled } from "~/lib/features.server"
import { RUN_OVERDUE_DAYS } from "~/lib/finance-stages.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.awaiting-carmen"

export const meta: Route.MetaFunction = () => [
	{ title: "Carmen's payment — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const runs = await db.payrollRun.findMany({
		where: { paidAt: null, reversedAt: null },
		orderBy: { generatedAt: "asc" },
		select: {
			id: true,
			label: true,
			generatedAt: true,
			accounts: {
				select: {
					contractorAccountId: true,
					paidAt: true,
					confirmedByFallback: true,
					contractorAccount: { select: { code: true, label: true } },
					paidBy: { select: { name: true } },
				},
			},
		},
	})
	const counts = await db.jafInvoice.groupBy({
		by: ["payrollRunId", "contractorAccountId"],
		where: { payrollRunId: { in: runs.map((r) => r.id) } },
		_count: true,
	})
	const jobsByKey = new Map(
		counts.map((c) => [`${c.payrollRunId}:${c.contractorAccountId}`, c._count]),
	)
	const now = Date.now()
	return {
		user,
		fallbackEnabled: isPayrollFallbackEnabled(),
		runs: runs.map((run) => {
			const ageDays = Math.floor((now - run.generatedAt.getTime()) / 86_400_000)
			return {
				id: run.id,
				label: run.label,
				generatedAt: run.generatedAt.toISOString(),
				ageDays,
				overdue: ageDays > RUN_OVERDUE_DAYS,
				accounts: run.accounts
					.map((a) => ({
						accountId: a.contractorAccountId,
						code: a.contractorAccount.code,
						label: a.contractorAccount.label,
						jobs: jobsByKey.get(`${run.id}:${a.contractorAccountId}`) ?? 0,
						paidAt: a.paidAt ? a.paidAt.toISOString() : null,
						paidByName: a.paidBy?.name ?? null,
						confirmedByFallback: a.confirmedByFallback,
					}))
					.sort((x, y) => x.code.localeCompare(y.code)),
			}
		}),
	}
}

function ConfirmFromPaper({
	runId,
	accountId,
}: {
	runId: string
	accountId: string
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher()
	const today = new Date().toLocaleDateString("en-CA")
	const submitting = fetcher.state !== "idle"
	return (
		<fetcher.Form
			method="post"
			action={`/finance/payroll/${runId}`}
			className="flex flex-wrap items-center gap-2"
			onSubmit={(e) => {
				if (!window.confirm(t("finance_carmen.confirm_prompt")))
					e.preventDefault()
			}}
		>
			<input type="hidden" name="intent" value="confirm_account" />
			<input type="hidden" name="accountId" value={accountId} />
			<input
				type="date"
				name="paidDate"
				required
				max={today}
				aria-label={t("finance_payroll.paid_date")}
				className="border rounded px-2 py-1 text-xs"
			/>
			<Button type="submit" variant="secondary" size="xs" disabled={submitting}>
				{t("finance_carmen.confirm")}
			</Button>
		</fetcher.Form>
	)
}

export default function FinanceAwaitingCarmen({
	loaderData,
}: Route.ComponentProps) {
	const { runs, fallbackEnabled } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("finance_carmen.title")}</h1>
				<StageChip arm="A" step={5} total={5} />
			</div>
			<FinanceStepRail current="CARMEN" />
			<Callout title={t("finance_flow.callout.carmen_title")}>
				{t("finance_flow.callout.carmen_body")}
			</Callout>
			{!fallbackEnabled && runs.length > 0 && (
				<p className="text-sm text-muted-foreground">
					{t("finance_carmen.fallback_off")}
				</p>
			)}
			{runs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_carmen.none")}
				</p>
			) : (
				runs.map((run) => {
					const paid = run.accounts.filter((a) => a.paidAt).length
					return (
						<section key={run.id} className="rounded-lg border p-3 space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="font-medium">{run.label}</h2>
									<span className="text-sm text-muted-foreground">
										{new Date(run.generatedAt).toLocaleDateString()}
									</span>
									<span
										className={
											run.overdue
												? "text-sm font-medium text-destructive"
												: "text-sm text-muted-foreground"
										}
									>
										{t("finance_carmen.age", { days: run.ageDays })}
									</span>
									{run.overdue && (
										<Badge variant="warn">{t("finance_carmen.overdue")}</Badge>
									)}
									<span className="text-sm">
										{t("finance_carmen.paid_of", {
											paid,
											total: run.accounts.length,
										})}
									</span>
								</div>
								<Link to={`/finance/payroll/${run.id}`} className="underline">
									{t("finance_carmen.open_list")}
								</Link>
							</div>
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-muted-foreground">
										<th className="p-2">{t("finance_payroll.col.brigade")}</th>
										<th className="p-2">{t("finance_payroll.col.jobs")}</th>
										<th className="p-2">{t("finance_payroll.col.status")}</th>
									</tr>
								</thead>
								<tbody>
									{run.accounts.map((a) => (
										<tr key={a.accountId} className="border-t">
											<td className="p-2">
												{a.code} · {a.label}
											</td>
											<td className="p-2">{a.jobs}</td>
											<td className="p-2">
												{a.paidAt ? (
													<span>
														{t("finance_payroll.paid_by", {
															date: new Date(a.paidAt).toLocaleDateString(),
															name: a.paidByName ?? "",
														})}
														{a.confirmedByFallback && (
															<>
																{" · "}
																{t("finance_payroll.from_paper")}
															</>
														)}
													</span>
												) : (
													<div className="flex flex-wrap items-center gap-3">
														<span className="text-muted-foreground">
															{t("finance_carmen.waiting")}
														</span>
														{fallbackEnabled && (
															<ConfirmFromPaper
																runId={run.id}
																accountId={a.accountId}
															/>
														)}
													</div>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					)
				})
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

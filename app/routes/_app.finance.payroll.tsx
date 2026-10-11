import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { isPayrollFallbackEnabled } from "~/lib/features.server"
import {
	ageDays,
	loadStageRows,
	PAGE_SIZE,
} from "~/lib/finance-stage-rows.server"
import {
	RUN_OVERDUE_DAYS,
	unfundedSweepableIds,
} from "~/lib/finance-stages.server"
import {
	blockedSentJobs,
	EmptyRunError,
	generateRun,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll"

export const meta: Route.MetaFunction = () => [
	{ title: "Lists to Carmen — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const [{ rows, totalCount, sweepableIds }, sentRuns, blocked] =
		await Promise.all([
			loadStageRows({
				stage: "LISTS",
				page,
				pageSize: PAGE_SIZE,
				ageFrom: "sent",
				withAccounts: true,
			}),
			db.payrollRun.findMany({
				orderBy: { generatedAt: "desc" },
				take: 20,
				select: {
					id: true,
					label: true,
					generatedAt: true,
					paidAt: true,
					reversedAt: true,
					_count: { select: { invoices: true } },
				},
			}),
			blockedSentJobs(),
		])
	const now = new Date()
	return {
		user,
		eligible: rows,
		// Every funded, mapped packet on any page: the client keeps an accurate
		// "N selected" across pages from this.
		sweepableIds,
		sweepableCount: sweepableIds.length,
		sentRuns: sentRuns.map((r) => ({
			...r,
			ageDays: ageDays(r.generatedAt, now),
		})),
		blocked,
		fallbackEnabled: isPayrollFallbackEnabled(),
		overdueDays: RUN_OVERDUE_DAYS,
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	if (intent !== "generate_run")
		return { errorKey: "finance_payroll.errors.unknown_intent" }
	const label =
		(form.get("label") as string | null)?.trim() ||
		new Date().toISOString().slice(0, 10)
	const formExcluded = form
		.getAll("excludeIds")
		.filter((v): v is string => typeof v === "string" && v !== "")
	// Only bank-funded packets may go on a list for Carmen. The server rule is
	// not enforced yet (see spec follow-up), so hold unfunded ones back here,
	// computed at submit time rather than trusted from the form.
	const excludeIds = [
		...new Set([...formExcluded, ...(await unfundedSweepableIds())]),
	]
	try {
		const { run } = await generateRun({
			generatedById: user.id,
			label,
			excludeIds,
		})
		throw redirect(`/finance/payroll/${run.id}`)
	} catch (e) {
		if (e instanceof EmptyRunError)
			return { errorKey: "finance_payroll.errors.empty_run" as const }
		throw e
	}
}

export default function FinancePayrollList({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { eligible, sweepableIds, sentRuns, blocked, pagination, overdueDays } =
		loaderData
	const { t } = useTranslation()
	// Everything ready is in the list by default; the set holds the packets
	// Lissette UNticked to hold back. Kept across pages, in this component.
	const [held, setHeld] = useState<Set<string>>(new Set())
	const selectAllRef = useRef<HTMLInputElement>(null)
	const selectable = eligible.filter((r) => r.accountResolved)
	const pageHeld = selectable.filter((r) => held.has(r.id)).length
	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate =
				pageHeld > 0 && pageHeld < selectable.length
		}
	}, [pageHeld, selectable.length])
	const toggleAll = () => {
		const next = new Set(held)
		if (pageHeld === 0) for (const r of selectable) next.add(r.id)
		else for (const r of selectable) next.delete(r.id)
		setHeld(next)
	}
	// Only mapped packets can be swept, so only they count toward the button.
	const listCount = sweepableIds.filter((id) => !held.has(id)).length
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lists")}
				</h1>
				<StageChip arm="A" step={4} total={5} />
			</div>
			<FinanceStepRail current="LISTS" />
			<Callout title={t("finance_flow.callout.lists_title")}>
				{t("finance_flow.callout.lists_body")}
			</Callout>
			{actionData?.errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{actionData.errorKey === "finance_payroll.errors.empty_run"
						? t("finance_payroll.errors.empty_run")
						: t("finance_payroll.errors.unknown_intent")}
				</p>
			)}

			<section className="space-y-3">
				<h2 className="font-semibold">{t("finance_payroll.ready_title")}</h2>
				{eligible.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("finance_payroll.none_ready")}
					</p>
				) : (
					<>
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							<input
								type="checkbox"
								ref={selectAllRef}
								checked={pageHeld === 0}
								onChange={toggleAll}
							/>
							{t("finance_payroll.select_all")}
						</label>
						<FinanceStageTable
							rows={eligible}
							to={(r) => `/finance/pbcc/${r.id}`}
							ageLabelKey="finance_stage.age.sent"
							action={(r) => (
								<div className="flex flex-wrap items-center gap-2">
									<input
										type="checkbox"
										aria-label={t("finance_payroll.include_row", {
											number: r.controlNumber,
										})}
										checked={!held.has(r.id)}
										disabled={!r.accountResolved}
										onChange={(e) => {
											const next = new Set(held)
											if (e.target.checked) next.delete(r.id)
											else next.add(r.id)
											setHeld(next)
										}}
									/>
									{!r.accountResolved && (
										<Badge variant="warn">
											{t("finance_queue.account_unmapped")}
										</Badge>
									)}
									{r.missingClaroPdf && (
										<Badge variant="warn">
											{t("finance_queue.missing_claro_pdf")}
										</Badge>
									)}
								</div>
							)}
						/>
						<StagePagination
							basePath="/finance/payroll"
							pagination={pagination}
							pageSize={PAGE_SIZE}
						/>
					</>
				)}
				<Form method="post" className="flex items-center gap-2">
					<input type="hidden" name="intent" value="generate_run" />
					{Array.from(held).map((id) => (
						<input key={id} type="hidden" name="excludeIds" value={id} />
					))}
					<input
						type="text"
						name="label"
						placeholder={t("finance_payroll.run_label_placeholder")}
						className="border rounded px-2 py-1"
					/>
					<Button type="submit" disabled={listCount === 0}>
						{t("finance_payroll.create_list", { count: listCount })}
					</Button>
				</Form>
			</section>

			{blocked.length > 0 && (
				<div className="bg-card border rounded-lg p-4 space-y-1">
					<h2 className="font-semibold text-sm">
						{t("finance_payroll.blocked_title")}
					</h2>
					<ul className="text-sm space-y-1">
						{blocked.map((job) => (
							<li key={job.id}>
								<span className="font-mono">{job.controlNumber}</span>{" "}
								<span className="text-muted-foreground">
									{t("finance_payroll.blocked_reason")}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			<section className="space-y-3">
				<h2 className="font-semibold">{t("finance_payroll.sent_title")}</h2>
				{sentRuns.length === 0 ? null : (
					<div className="overflow-x-auto bg-card border rounded-lg">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-xs text-muted-foreground text-left border-b">
									<th className="p-2">{t("finance_payroll.col.list")}</th>
									<th className="p-2">{t("finance_payroll.col.date")}</th>
									<th className="p-2 text-right">
										{t("finance_payroll.col.jobs")}
									</th>
									<th className="p-2 text-right">
										{t("finance_payroll.col.age")}
									</th>
									<th className="p-2">{t("finance_payroll.col.status")}</th>
									<th className="p-2" />
								</tr>
							</thead>
							<tbody>
								{sentRuns.map((run) => {
									const overdue =
										!run.paidAt && !run.reversedAt && run.ageDays > overdueDays
									return (
										<tr
											key={run.id}
											className="border-b last:border-0 hover:bg-muted/40"
										>
											<td className="p-2">
												<Link
													to={`/finance/payroll/${run.id}`}
													className="underline"
												>
													{run.label}
												</Link>
											</td>
											<td className="p-2">
												{new Date(run.generatedAt).toLocaleDateString()}
											</td>
											<td className="p-2 text-right font-mono">
												{run._count.invoices}
											</td>
											<td className="p-2 text-right font-mono">
												{run.ageDays}
											</td>
											<td className="p-2 space-x-1">
												{run.paidAt ? (
													<Badge variant="ok">
														{t("finance_payroll.paid_on", {
															date: new Date(run.paidAt).toLocaleDateString(),
														})}
													</Badge>
												) : run.reversedAt ? (
													<Badge>{t("finance_payroll.reversed")}</Badge>
												) : (
													<Badge>{t("finance_payroll.open")}</Badge>
												)}
												{overdue && (
													<Badge variant="warn">
														{t("finance_payroll.overdue", {
															days: run.ageDays,
														})}
													</Badge>
												)}
											</td>
											<td className="p-2">
												<Link
													to={`/finance/payroll/${run.id}`}
													className="underline"
												>
													{t("finance_payroll.see_carmen")}
												</Link>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

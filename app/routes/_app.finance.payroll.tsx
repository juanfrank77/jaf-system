import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useRevalidator } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { PayrollRequestCard } from "~/components/payroll-request-card"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { loadStageRows } from "~/lib/finance-stage-rows.server"
import { RUN_OVERDUE_DAYS } from "~/lib/finance-stages.server"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import {
	defaultPeriodLabel,
	type PayrollTab,
	parsePayrollTab,
} from "~/lib/payroll-request-view"
import { loadPayrollRequests } from "~/lib/payroll-request-view.server"
import {
	blockedSentJobs,
	EmptyRunError,
	generateRun,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll to Carmen — JAF Ops" },
]

/** How often the Waiting tab looks again, so Carmen's ticks appear on their own. */
const WAITING_REFRESH_MS = 5000

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const tab = parsePayrollTab(url.searchParams.get("tab"))
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const [waitingCount, paidCount] = await Promise.all([
		db.payrollRun.count({
			where: { reversedAt: null, sentAt: { not: null }, paidAt: null },
		}),
		db.payrollRun.count({ where: { reversedAt: null, paidAt: { not: null } } }),
	])
	const base = {
		user,
		tab,
		waitingCount,
		paidCount,
		overdueDays: RUN_OVERDUE_DAYS,
		defaultLabel: defaultPeriodLabel(),
	}
	if (tab === "waiting") {
		return {
			...base,
			requests: await loadPayrollRequests({
				sentAt: { not: null },
				paidAt: null,
			}),
			eligible: [],
			sweepableIds: [] as string[],
			drafts: [],
			blocked: [],
			pagination: { page, totalPages: 1, totalCount: 0 },
		}
	}
	if (tab === "paid") {
		return {
			...base,
			requests: await loadPayrollRequests(
				{ paidAt: { not: null } },
				{ take: 20 },
			),
			eligible: [],
			sweepableIds: [] as string[],
			drafts: [],
			blocked: [],
			pagination: { page, totalPages: 1, totalCount: 0 },
		}
	}
	const [{ rows, totalCount, sweepableIds }, drafts, blocked] =
		await Promise.all([
			loadStageRows({
				stage: "LISTS",
				page,
				pageSize: PAGE_SIZE,
				ageFrom: "sent",
				withAccounts: true,
			}),
			loadPayrollRequests({ sentAt: null }),
			blockedSentJobs(),
		])
	return {
		...base,
		requests: [],
		// Every sold, mapped Aviso on any page: the client keeps an accurate
		// "N selected" across pages from this.
		eligible: rows,
		sweepableIds,
		drafts,
		blocked,
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
		return { errorKey: "finance_payroll.errors.unknown_intent" as const }
	const label =
		(form.get("label") as string | null)?.trim() || defaultPeriodLabel()
	const excludeIds = form
		.getAll("excludeIds")
		.filter((v): v is string => typeof v === "string" && v !== "")
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

function PayrollTabs({
	tab,
	waitingCount,
	paidCount,
}: {
	tab: PayrollTab
	waitingCount: number
	paidCount: number
}) {
	const { t } = useTranslation()
	const cls = (active: boolean) =>
		active
			? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
			: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
	return (
		<nav className="flex border-b">
			<Link to="?tab=ready" className={cls(tab === "ready")}>
				{t("finance_payroll.tab.ready")}
			</Link>
			<Link to="?tab=waiting" className={cls(tab === "waiting")}>
				{t("finance_payroll.tab.waiting")} {waitingCount}
			</Link>
			<Link to="?tab=paid" className={cls(tab === "paid")}>
				{t("finance_payroll.tab.paid")} {paidCount}
			</Link>
		</nav>
	)
}

/** Looks again on a timer while the Waiting tab is open and visible. */
function useAutoRefresh(active: boolean) {
	const { revalidate, state } = useRevalidator()
	useEffect(() => {
		if (!active) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible" && state === "idle")
				revalidate()
		}, WAITING_REFRESH_MS)
		return () => window.clearInterval(id)
	}, [active, revalidate, state])
}

export default function FinancePayrollList({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		tab,
		eligible,
		sweepableIds,
		requests,
		drafts,
		blocked,
		pagination,
		overdueDays,
		defaultLabel,
		waitingCount,
		paidCount,
	} = loaderData
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
	useAutoRefresh(tab === "waiting")
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lists")}
				</h1>
				<StageChip arm="A" step={3} total={FINANCE_STEPS.length} />
			</div>
			<FinanceStepRail current="LISTS" />
			<Callout title={t("finance_flow.callout.lists_title")}>
				{t("finance_flow.callout.lists_body")}
			</Callout>
			<PayrollTabs
				tab={tab}
				waitingCount={waitingCount}
				paidCount={paidCount}
			/>
			{actionData?.errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{actionData.errorKey === "finance_payroll.errors.empty_run"
						? t("finance_payroll.errors.empty_run")
						: t("finance_payroll.errors.unknown_intent")}
				</p>
			)}

			{tab === "ready" && (
				<>
					{drafts.length > 0 && (
						<section className="space-y-3">
							<h2 className="font-semibold">
								{t("finance_payroll.drafts_title")}
							</h2>
							{drafts.map((d) => (
								<PayrollRequestCard
									key={d.id}
									request={d}
									actions={
										<>
											<Link
												to={`/finance/payroll/${d.id}`}
												className="text-sm underline"
											>
												{t("finance_payroll.open_request")}
											</Link>
											<a
												href={`/finance/payroll/${d.id}/journal`}
												download
												className={buttonVariants({ variant: "secondary" })}
											>
												{t("finance_payroll.download_journal_pdf")}
											</a>
											<Form method="post" action={`/finance/payroll/${d.id}`}>
												<input type="hidden" name="intent" value="send_run" />
												<Button type="submit" disabled={d.lines.length === 0}>
													{t("finance_payroll.send")}
												</Button>
											</Form>
										</>
									}
								/>
							))}
						</section>
					)}

					<section className="space-y-3">
						<h2 className="font-semibold">
							{t("finance_payroll.ready_title")}
						</h2>
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
										checked={selectable.length > 0 && pageHeld === 0}
										disabled={selectable.length === 0}
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
													{t("finance_queue.brigade_not_linked")}
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
						<Form method="post" className="flex flex-wrap items-center gap-2">
							<input type="hidden" name="intent" value="generate_run" />
							{Array.from(held).map((id) => (
								<input key={id} type="hidden" name="excludeIds" value={id} />
							))}
							<input
								type="text"
								name="label"
								defaultValue={defaultLabel}
								aria-label={t("finance_payroll.period_label")}
								className="border rounded px-2 py-1"
							/>
							<Button type="submit" disabled={listCount === 0}>
								{t("finance_payroll.create_request", { count: listCount })}
							</Button>
							{listCount === 0 && blocked.length > 0 && (
								<span className="text-sm text-muted-foreground">
									{t("finance_payroll.none_selected_blocked", {
										count: blocked.length,
									})}
								</span>
							)}
						</Form>
					</section>
				</>
			)}

			{tab !== "ready" && (
				<section className="space-y-3">
					{requests.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{tab === "waiting"
								? t("finance_payroll.none_waiting")
								: t("finance_payroll.none_paid")}
						</p>
					) : (
						requests.map((r) => (
							<PayrollRequestCard
								key={r.id}
								request={r}
								overdueDays={overdueDays}
								actions={
									<Link
										to={`/finance/payroll/${r.id}`}
										className="text-sm underline"
									>
										{t("finance_payroll.open_request")}
									</Link>
								}
							/>
						))
					)}
				</section>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

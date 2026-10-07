import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import {
	computeContractorPayment,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [
	{ title: "Packets in — JAF Ops" },
]

const PAGE_SIZE = 50

type QueueJob = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	contractorLabel: string | null
	/** Gross invoice total, live-computed (no job on L1 is swept yet). */
	gross: number
	/** Brigade's est. payable: per-line truncated gross × 0.585. */
	estPayable: number
	releasedAt: Date | null
	accountResolved: boolean
	missingClaroPdf: boolean
}

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	// ONE query feeds the list, the tiles, the pagination count and the "Generate
	// run" button (q&a 15.6): they cannot disagree, and no job finance can't see
	// is ever swept. Paging is done on the already-ordered result.
	const docs = await db.jafInvoice.findMany({
		where: armAOpenWhere(),
		orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
		select: {
			id: true,
			controlNumber: true,
			avisoNumber: true,
			claroPdfPath: true,
			releasedToFinanceAt: true,
			jafInvoiceLines: true,
			contractorAccountCode: true,
			preCertSheets: {
				orderBy: { version: "desc" },
				take: 1,
				select: { sigSubcontractorName: true },
			},
			brigade: { select: { leadName: true, name: true } },
		},
	})
	const resolved = await resolveContractorAccounts(
		docs.map((d) => d.contractorAccountCode),
	)
	const all: QueueJob[] = docs.map((d) => {
		const payment = computeContractorPayment(
			toContractorPaymentLines(d.jafInvoiceLines),
		)
		return {
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			contractorLabel:
				d.preCertSheets[0]?.sigSubcontractorName ??
				d.brigade?.leadName ??
				d.brigade?.name ??
				null,
			gross: payment.grossPayable,
			estPayable: payment.netPayable,
			releasedAt: d.releasedToFinanceAt,
			// Resolved live for the row's badge — this does NOT persist
			// contractorAccountId (only generateRun does).
			accountResolved: d.contractorAccountCode
				? resolved.has(d.contractorAccountCode)
				: false,
			missingClaroPdf: !d.claroPdfPath || d.claroPdfPath.trim() === "",
		}
	})

	const totalCount = all.length
	const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
	const jobs = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

	// Awaiting payroll: jobs on a run that is generated (sent to Carmen) but not
	// yet marked PAID. They are not in the table above — they are listed per run
	// on the Awaiting payroll screen, which this tile links to.
	const awaiting = await db.jafInvoice.findMany({
		where: { payrollRunId: { not: null }, payablesClosedAt: null },
		select: { grossPayable: true, netPayable: true },
	})
	const awaitingPayrollGross = awaiting.reduce(
		(sum, d) => sum + toNumberPrice(d.grossPayable),
		0,
	)
	const awaitingPayrollEst = awaiting.reduce(
		(sum, d) => sum + toNumberPrice(d.netPayable),
		0,
	)

	return {
		user,
		jobs,
		// Every open job's id + whether a run could sweep it, so the client can
		// keep an accurate "N selected" across pages.
		openJobs: all.map((j) => ({ id: j.id, sweepable: j.accountResolved })),
		tiles: {
			newPackets: {
				count: all.length,
				gross: all.reduce((sum, j) => sum + j.gross, 0),
				estPayable: all.reduce((sum, j) => sum + j.estPayable, 0),
			},
			awaitingPayroll: {
				count: awaiting.length,
				gross: awaitingPayrollGross,
				estPayable: awaitingPayrollEst,
			},
		},
		pagination: { page, totalPages, totalCount },
	}
}

export default function FinanceQueue({ loaderData }: Route.ComponentProps) {
	const { jobs, openJobs, tiles, pagination } = loaderData
	const { t } = useTranslation()
	// Everything ready is in the run by default (q&a 15.4); the set holds the
	// jobs Lissette UNticked to hold back. Kept across pages, in this component.
	const [held, setHeld] = useState<Set<string>>(new Set())
	const selectAllRef = useRef<HTMLInputElement>(null)
	const pageHeld = jobs.filter((j) => held.has(j.id)).length
	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate =
				pageHeld > 0 && pageHeld < jobs.length
		}
	}, [pageHeld, jobs.length])

	const toggleAll = () => {
		const next = new Set(held)
		if (pageHeld === 0) for (const j of jobs) next.add(j.id)
		else for (const j of jobs) next.delete(j.id)
		setHeld(next)
	}
	// Only mapped jobs can be swept, so only they count toward the button.
	const runCount = openJobs.filter((j) => j.sweepable && !held.has(j.id)).length
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("finance_queue.title")}</h1>
				<div className="flex gap-2 text-xs">
					<span className="bg-muted px-3 py-1 rounded-full">
						{t("finance_queue.stat.new_packets_summary", {
							count: tiles.newPackets.count,
							gross: formatMoney(tiles.newPackets.gross),
							est: formatMoney(tiles.newPackets.estPayable),
						})}
					</span>
					<Link
						to="/finance/payroll"
						className="bg-muted px-3 py-1 rounded-full hover:bg-muted/70"
					>
						{t("finance_queue.stat.awaiting_payroll_summary", {
							count: tiles.awaitingPayroll.count,
							gross: formatMoney(tiles.awaitingPayroll.gross),
							est: formatMoney(tiles.awaitingPayroll.estPayable),
						})}
					</Link>
				</div>
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.queue_title")}>
				{t("finance_flow.callout.queue_body")}
			</Callout>
			<p className="text-sm text-muted-foreground">{t("finance_queue.hint")}</p>
			{jobs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<>
					<div className="overflow-x-auto bg-card border rounded-lg">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-xs text-muted-foreground text-left border-b">
									<th className="p-2">
										<input
											type="checkbox"
											ref={selectAllRef}
											checked={pageHeld === 0}
											onChange={toggleAll}
										/>
									</th>
									<th className="p-2">{t("finance_queue.col.work_order")}</th>
									<th className="p-2">{t("finance_queue.col.aviso")}</th>
									<th className="p-2">{t("finance_queue.col.contractor")}</th>
									<th className="p-2 text-right">
										{t("finance_queue.col.gross")}
									</th>
									<th className="p-2 text-right">
										{t("finance_queue.col.est_payable")}
									</th>
									<th className="p-2">{t("finance_queue.col.packet")}</th>
								</tr>
							</thead>
							<tbody>
								{jobs.map((r) => (
									<tr
										key={r.id}
										className="border-b last:border-0 hover:bg-muted/40"
									>
										<td className="p-2">
											<input
												type="checkbox"
												checked={!held.has(r.id)}
												disabled={!r.accountResolved}
												onChange={(e) => {
													const next = new Set(held)
													if (e.target.checked) next.delete(r.id)
													else next.add(r.id)
													setHeld(next)
												}}
												onClick={(e) => e.stopPropagation()}
											/>
										</td>
										<td className="p-2 font-mono">
											<Link to={`/finance/pbcc/${r.id}`} className="underline">
												{r.controlNumber}
											</Link>
										</td>
										<td className="p-2">{r.avisoNumber ?? "—"}</td>
										<td className="p-2">{r.contractorLabel ?? "—"}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(r.gross)}
										</td>
										<td className="p-2 text-right font-mono">
											{`${formatMoney(r.estPayable)} ${t("finance_queue.est_label")}`}
										</td>
										<td className="p-2 space-x-1">
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
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="flex items-center gap-4">
						<Form method="post" action="/finance/payroll">
							<input type="hidden" name="intent" value="generate_run" />
							{Array.from(held).map((id) => (
								<input key={id} type="hidden" name="excludeIds" value={id} />
							))}
							<input type="hidden" name="label" value="" />
							<Button type="submit" variant="default" disabled={runCount === 0}>
								{t("finance_queue.generate_run_selected", {
									count: runCount,
								})}
							</Button>
						</Form>
						<span className="text-xs text-muted-foreground">
							{t("finance_queue.select_hint")}
						</span>
					</div>
				</>
			)}
			{pagination.totalPages > 1 && (
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">
						{t("finance_queue.pagination.summary", {
							from: (pagination.page - 1) * PAGE_SIZE + 1,
							to: Math.min(pagination.page * PAGE_SIZE, pagination.totalCount),
							total: pagination.totalCount,
						})}
					</span>
					<div className="flex gap-2">
						<Link
							to={`/finance/queue?page=${Math.max(1, pagination.page - 1)}`}
							className={
								pagination.page <= 1
									? "pointer-events-none opacity-50"
									: undefined
							}
						>
							{t("finance_queue.pagination.prev")}
						</Link>
						<span>
							{t("finance_queue.pagination.page", {
								current: pagination.page,
								total: pagination.totalPages,
							})}
						</span>
						<Link
							to={`/finance/queue?page=${pagination.page + 1}`}
							className={
								pagination.page >= pagination.totalPages
									? "pointer-events-none opacity-50"
									: undefined
							}
						>
							{t("finance_queue.pagination.next")}
						</Link>
					</div>
				</div>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

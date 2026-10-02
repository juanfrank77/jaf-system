import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
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
	/** Gross invoice total (live-computed est. for unswept, frozen for swept). */
	gross: number
	/** Brigade's payable: gross × 0.65 × 0.90, truncated to cents. */
	estPayable: number
	/** True when the job has been swept into a payroll run (frozen figures). */
	frozen: boolean
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
	const skip = (page - 1) * PAGE_SIZE
	const [totalCount, docs] = await Promise.all([
		db.jafInvoice.count({ where: armAOpenWhere() }),
		db.jafInvoice.findMany({
			where: armAOpenWhere(),
			orderBy: { releasedToFinanceAt: "asc" },
			skip,
			take: PAGE_SIZE,
			select: {
				id: true,
				controlNumber: true,
				avisoNumber: true,
				claroPdfPath: true,
				releasedToFinanceAt: true,
				grossPayable: true,
				netPayable: true,
				jafInvoiceLines: true,
				contractorAccountCode: true,
				preCertSheets: {
					orderBy: { version: "desc" },
					take: 1,
					select: { sigSubcontractorName: true },
				},
				brigade: { select: { leadName: true, name: true } },
			},
		}),
	])
	// One query for every distinct code on the page instead of one per row
	// (up to 200 round-trips just to render the "unmapped" badge).
	const resolved = await resolveContractorAccounts(
		docs.map((d) => d.contractorAccountCode),
	)
	const jobs: QueueJob[] = docs.map((d) => {
		const frozen = d.grossPayable != null
		const payment = frozen
			? {
					grossPayable: toNumberPrice(d.grossPayable),
					netPayable: toNumberPrice(d.netPayable),
					retentionAmount: 0,
					contractorShareLines: [],
				}
			: computeContractorPayment(toContractorPaymentLines(d.jafInvoiceLines))
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
			frozen,
			releasedAt: d.releasedToFinanceAt,
			// Not yet swept into a run, so resolved live for the row's badge —
			// this does NOT persist contractorAccountId (only generateRun does).
			accountResolved: d.contractorAccountCode
				? resolved.has(d.contractorAccountCode)
				: false,
			missingClaroPdf: !d.claroPdfPath || d.claroPdfPath.trim() === "",
		}
	})

	// Awaiting payroll: jobs already swept into an open run that Carmen has not
	// marked PAID yet. These are NOT on the L1 table — they live on L3 — but the
	// tile shows their count and aggregate est. payable (frozen figures).
	const awaitingPayrollDocs = await db.jafInvoice.findMany({
		where: {
			payrollRunId: { not: null },
			payablesClosedAt: null,
		},
		select: {
			grossPayable: true,
			netPayable: true,
		},
	})
	const awaitingPayrollCount = awaitingPayrollDocs.length
	const awaitingPayrollGross = awaitingPayrollDocs.reduce(
		(sum, d) => sum + toNumberPrice(d.grossPayable),
		0,
	)
	const awaitingPayrollEst = awaitingPayrollDocs.reduce(
		(sum, d) => sum + toNumberPrice(d.netPayable),
		0,
	)

	// New packets: jobs released to finance, not yet swept into a run.
	const newPacketGross = jobs.reduce((sum, j) => sum + j.gross, 0)
	const newPacketEst = jobs.reduce((sum, j) => sum + j.estPayable, 0)
	return {
		user,
		jobs,
		tiles: {
			newPackets: {
				count: jobs.length,
				gross: newPacketGross,
				estPayable: newPacketEst,
			},
			awaitingPayroll: {
				count: awaitingPayrollCount,
				gross: awaitingPayrollGross,
				estPayable: awaitingPayrollEst,
			},
		},
		pagination: {
			page,
			totalPages: Math.ceil(totalCount / PAGE_SIZE),
			totalCount,
		},
	}
}

export default function FinanceQueue({ loaderData }: Route.ComponentProps) {
	const { jobs, tiles, pagination } = loaderData
	const { t } = useTranslation()
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const selectAllRef = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate =
				selected.size > 0 && selected.size < jobs.length
		}
	}, [selected, jobs.length])

	const toggleAll = () => {
		if (selected.size === jobs.length) setSelected(new Set())
		else setSelected(new Set(jobs.map((j) => j.id)))
	}
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("finance_queue.title")}</h1>
				<div className="flex gap-2 text-xs">
					<span className="bg-slate-100 px-3 py-1 rounded-full">
						{t("finance_queue.stat.new_packets_summary", {
							count: tiles.newPackets.count,
							gross: formatMoney(tiles.newPackets.gross),
							est: formatMoney(tiles.newPackets.estPayable),
						})}
					</span>
					<span className="bg-slate-100 px-3 py-1 rounded-full">
						{t("finance_queue.stat.awaiting_payroll_summary", {
							count: tiles.awaitingPayroll.count,
							gross: formatMoney(tiles.awaitingPayroll.gross),
							est: formatMoney(tiles.awaitingPayroll.estPayable),
						})}
					</span>
				</div>
			</div>
			<p className="text-sm text-slate-500">{t("finance_queue.hint")}</p>
			{jobs.length === 0 ? (
				<p className="text-sm text-slate-400">{t("finance_queue.empty")}</p>
			) : (
				<>
					<div className="overflow-x-auto bg-white border rounded-lg">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-xs text-slate-500 text-left border-b">
									<th className="p-2">
										<input
											type="checkbox"
											ref={selectAllRef}
											checked={selected.size === jobs.length}
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
												checked={selected.has(r.id)}
												onChange={(e) => {
													const next = new Set(selected)
													if (e.target.checked) next.add(r.id)
													else next.delete(r.id)
													setSelected(next)
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
											{r.frozen
												? formatMoney(r.estPayable)
												: `${formatMoney(r.estPayable)} ${t("finance_queue.est_label")}`}
										</td>
										<td className="p-2 space-x-1">
											{!r.frozen && (
												<Badge variant="info">
													{t("finance_queue.est_label")}
												</Badge>
											)}
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
							<input
								type="hidden"
								name="selectedIds"
								value={Array.from(selected).join(",")}
							/>
							<input type="hidden" name="label" value="" />
							<Button
								type="submit"
								variant="default"
								disabled={selected.size === 0}
							>
								{t("finance_queue.generate_run_selected", {
									count: selected.size,
								})}
							</Button>
						</Form>
						<span className="text-xs text-slate-500">
							{t("finance_queue.select_hint")}
						</span>
					</div>
				</>
			)}
			{pagination.totalPages > 1 && (
				<div className="flex items-center justify-between text-sm">
					<span className="text-slate-500">
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

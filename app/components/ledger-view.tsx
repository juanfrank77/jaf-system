import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import type { AvisoSummary } from "~/lib/aviso-summary"
import type {
	armAClock,
	claroAging,
	openMoney,
	waitingForPo,
} from "~/lib/ledger-reports"
import { formatShortDate } from "~/lib/payroll-request-view"
import { formatMoney } from "~/lib/utils"

export type LedgerReportKey =
	| "ledger"
	| "arm_a"
	| "waiting_po"
	| "aging"
	| "open_money"
export const LEDGER_REPORTS: LedgerReportKey[] = [
	"ledger",
	"arm_a",
	"waiting_po",
	"aging",
	"open_money",
]

type LedgerData = {
	rows: AvisoSummary[]
	armA: ReturnType<typeof armAClock>
	waiting: ReturnType<typeof waitingForPo>
	aging: ReturnType<typeof claroAging>
	open: ReturnType<typeof openMoney>
}

const dash = (v: number | null) => (v === null ? "—" : String(v))
const day = (iso: string | null) => (iso ? formatShortDate(iso) : "—")

function Table({
	head,
	children,
}: {
	head: string[]
	children: React.ReactNode
}) {
	return (
		<div className="overflow-x-auto rounded-lg border bg-card">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						{head.map((h) => (
							<th key={h} className="p-2">
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

function ReportLabel({ k }: { k: LedgerReportKey }) {
	const { t } = useTranslation()
	switch (k) {
		case "ledger":
			return t("ledger.report.ledger")
		case "arm_a":
			return t("ledger.report.arm_a")
		case "waiting_po":
			return t("ledger.report.waiting_po")
		case "aging":
			return t("ledger.report.aging")
		case "open_money":
			return t("ledger.report.open_money")
	}
}

/** W9: the Ledger and the four reports, for a date range, with the Excel export. */
export function LedgerView({
	from,
	to,
	report,
	data,
}: {
	from: string
	to: string
	report: LedgerReportKey
	data: LedgerData
}) {
	const { t } = useTranslation()
	const range = `from=${from}&to=${to}`
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<Form method="get" className="flex flex-wrap items-end gap-2">
					<input type="hidden" name="report" value={report} />
					<label className="text-xs">
						{t("ledger.from")}
						<Input
							type="date"
							name="from"
							defaultValue={from}
							className="h-8"
						/>
					</label>
					<label className="text-xs">
						{t("ledger.to")}
						<Input type="date" name="to" defaultValue={to} className="h-8" />
					</label>
					<Button type="submit" variant="secondary">
						{t("ledger.apply_range")}
					</Button>
				</Form>
				<a href={`/finance/ledger/export?${range}`}>
					<Button type="button">{t("ledger.export")}</Button>
				</a>
			</div>
			<nav className="flex flex-wrap border-b">
				{LEDGER_REPORTS.map((k) => (
					<Link
						key={k}
						to={`?report=${k}&${range}`}
						className={
							k === report
								? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
								: "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
						}
					>
						<ReportLabel k={k} />
					</Link>
				))}
			</nav>

			{report === "ledger" && (
				<Table
					head={[
						t("ledger.col.aviso"),
						t("ledger.col.supervisor"),
						t("ledger.col.billed"),
						t("ledger.col.sold"),
						t("ledger.col.brigade_paid"),
						t("ledger.col.pos"),
						t("ledger.col.outstanding"),
						t("ledger.col.status"),
					]}
				>
					{data.rows.map((r) => (
						<tr key={r.id} className="border-b last:border-0">
							<td className="p-2 font-mono">
								<Link to={`/finance/avisos/${r.id}`} className="underline">
									{r.avisoNumber ?? r.controlNumber}
								</Link>
							</td>
							<td className="p-2">{r.supervisor}</td>
							<td className="p-2 font-mono">{formatMoney(r.money.billed)}</td>
							<td className="p-2">{day(r.armA.sold.at)}</td>
							<td className="p-2">{day(r.armA.brigadePaid.at)}</td>
							<td className="p-2 font-mono">{r.pos.length}</td>
							<td className="p-2 font-mono">
								{formatMoney(r.money.outstanding)}
							</td>
							<td className="p-2">
								{r.done ? t("ledger.status.done") : t("ledger.status.open")}
							</td>
						</tr>
					))}
				</Table>
			)}

			{report === "arm_a" && (
				<div className="space-y-2">
					<p className="text-sm">
						{t("ledger.arm_a_average", {
							days: dash(data.armA.average),
							count: data.armA.items.length,
						})}
					</p>
					<Table
						head={[
							t("ledger.col.month"),
							t("ledger.col.count"),
							t("ledger.col.avg_days"),
						]}
					>
						{data.armA.months.map((m) => (
							<tr key={m.month} className="border-b last:border-0">
								<td className="p-2">{m.month}</td>
								<td className="p-2 font-mono">{m.count}</td>
								<td className="p-2 font-mono">{m.average}</td>
							</tr>
						))}
					</Table>
					<Table
						head={[
							t("ledger.col.aviso"),
							t("ledger.col.batch"),
							t("ledger.col.sold"),
							t("ledger.col.brigade_paid"),
							t("ledger.col.days"),
						]}
					>
						{data.armA.items.map((i) => (
							<tr
								key={`${i.avisoNumber}-${i.paidAt}`}
								className="border-b last:border-0"
							>
								<td className="p-2 font-mono">{i.avisoNumber}</td>
								<td className="p-2">{dash(i.batchNumber)}</td>
								<td className="p-2">{day(i.soldAt)}</td>
								<td className="p-2">{day(i.paidAt)}</td>
								<td className="p-2 font-mono">{i.days}</td>
							</tr>
						))}
					</Table>
				</div>
			)}

			{report === "waiting_po" && (
				<Table
					head={[
						t("ledger.col.aviso"),
						t("ledger.col.zone"),
						t("ledger.col.completed"),
						t("ledger.col.first_po"),
						t("ledger.col.days_first"),
						t("ledger.col.fully_po"),
						t("ledger.col.days_full"),
						t("ledger.col.still_to_po"),
					]}
				>
					{data.waiting.map((w) => (
						<tr
							key={`${w.avisoNumber}-${w.completedAt}`}
							className="border-b last:border-0"
						>
							<td className="p-2 font-mono">{w.avisoNumber}</td>
							<td className="p-2">{w.zone ?? "—"}</td>
							<td className="p-2">{day(w.completedAt)}</td>
							<td className="p-2">{day(w.firstPoAt)}</td>
							<td className="p-2 font-mono">{dash(w.daysToFirstPo)}</td>
							<td className="p-2">{day(w.fullyPoAt)}</td>
							<td className="p-2 font-mono">{dash(w.daysToFullyPo)}</td>
							<td className="p-2 font-mono">{formatMoney(w.stillToPo)}</td>
						</tr>
					))}
				</Table>
			)}

			{report === "aging" && (
				<div className="space-y-2">
					<p className="text-sm">
						{t("ledger.aging_summary", {
							count: data.aging.pastDueCount,
							amount: formatMoney(data.aging.pastDueAmount),
							avg: dash(data.aging.averageDays),
						})}
					</p>
					<Table
						head={[
							t("ledger.col.invoice"),
							t("ledger.col.aviso"),
							t("ledger.col.loaded"),
							t("ledger.col.paid"),
							t("ledger.col.days"),
							t("ledger.col.terms"),
							t("ledger.col.days_late"),
							t("ledger.col.amount"),
						]}
					>
						{data.aging.items.map((i) => (
							<tr key={i.invoiceNumber} className="border-b last:border-0">
								<td className="p-2 font-mono">{i.invoiceNumber}</td>
								<td className="p-2 font-mono">{i.avisoNumber}</td>
								<td className="p-2">{day(i.loadedAt)}</td>
								<td className="p-2">{day(i.paidAt)}</td>
								<td className="p-2 font-mono">{i.days}</td>
								<td className="p-2 font-mono">{i.termsDays}</td>
								<td
									className={`p-2 font-mono ${i.pastDue ? "text-status-danger" : ""}`}
								>
									{i.daysLate}
								</td>
								<td className="p-2 font-mono">{formatMoney(i.amount)}</td>
							</tr>
						))}
					</Table>
				</div>
			)}

			{report === "open_money" && (
				<div className="grid gap-3 md:grid-cols-3">
					{(
						[
							["billed_not_pod", data.open.billedNotPod],
							["pod_not_invoiced", data.open.podNotInvoiced],
							["in_ariba_not_paid", data.open.inAribaNotPaid],
						] as const
					).map(([k, v]) => (
						<div key={k} className="rounded-lg border bg-card p-3">
							<div className="text-xs uppercase text-muted-foreground">
								{k === "billed_not_pod"
									? t("ledger.open.billed_not_pod")
									: k === "pod_not_invoiced"
										? t("ledger.open.pod_not_invoiced")
										: t("ledger.open.in_ariba_not_paid")}
							</div>
							<div className="font-mono text-lg">{formatMoney(v)}</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

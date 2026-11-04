import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import {
	formatShortDate,
	type PayrollRequestView,
} from "~/lib/payroll-request-view"
import { formatMoney } from "~/lib/utils"

/**
 * One payroll request: a line per brigade with the Avisos it covers and what
 * it is paid. Read-only here; Carmen's own tick lives on her desk. Gross and
 * the JAF price are not in the data, so they cannot be shown.
 */
export function PayrollRequestCard({
	request,
	actions,
}: {
	request: PayrollRequestView
	/** Draft buttons (send / discard) and downloads, owned by the screen. */
	actions?: ReactNode
}) {
	const { t } = useTranslation()
	const totals = request.lines.reduce(
		(sum, l) => ({
			net: sum.net + l.net,
			retention: sum.retention + l.retention,
			toPay: sum.toPay + l.toPay,
		}),
		{ net: 0, retention: 0, toPay: 0 },
	)
	const paid = request.lines.filter((l) => l.paidAt).length
	const overdue = request.status === "waiting" && request.pastPayDay
	const dueToday = request.status === "waiting" && request.dueToday
	const hasD = request.lines.some((l) => l.unverified)
	return (
		<section
			aria-label={request.label}
			className={
				overdue
					? "space-y-2 rounded-lg border border-status-danger/40 bg-status-danger-soft p-4"
					: dueToday
						? "space-y-2 rounded-lg border border-status-warn/40 bg-status-warn-soft p-4"
						: "space-y-2 rounded-lg border bg-card p-4"
			}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					{t("finance_payroll.request_title", { label: request.label })}
					{request.sentAt && (
						<span className="ml-2 font-normal text-muted-foreground">
							{t("finance_payroll.sent_on", {
								date: formatShortDate(request.sentAt),
							})}
						</span>
					)}
				</h3>
				<div className="flex flex-wrap items-center gap-2">
					{request.status === "draft" && (
						<Badge variant="warn">{t("finance_payroll.draft")}</Badge>
					)}
					{request.status === "waiting" && (
						<Badge>
							{t("finance_payroll.progress", {
								paid,
								total: request.lines.length,
							})}
						</Badge>
					)}
					{overdue && (
						<Badge variant="warn">
							{t("finance_payroll.overdue", { days: request.ageDays })}
						</Badge>
					)}
					{dueToday && (
						<Badge variant="warn">{t("finance_payroll.due_today")}</Badge>
					)}
					{request.status === "paid" && request.paidAt && (
						<Badge variant="ok">
							{t("finance_payroll.paid_on", {
								date: formatShortDate(request.paidAt),
							})}
						</Badge>
					)}
					{actions}
				</div>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-2">{t("finance_payroll.col.brigade")}</th>
							<th className="p-2">{t("finance_payroll.col.avisos")}</th>
							<th className="p-2 text-right">{t("finance_payroll.col.net")}</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.retention")}
							</th>
							<th className="p-2 text-right">
								{t("finance_payroll.col.to_pay")}
							</th>
							<th className="p-2">{t("finance_payroll.col.status")}</th>
						</tr>
					</thead>
					<tbody>
						{request.lines.map((l) => (
							<tr key={l.brigadeCode} className="border-b last:border-0">
								<td className="p-2">
									<span className="font-mono">{l.brigadeCode}</span>{" "}
									<span className="text-muted-foreground">
										{l.brigadeLabel}
									</span>
									{l.unverified && (
										<Badge variant="warn" className="ml-2">
											{t("finance_payroll.d_unverified")}
										</Badge>
									)}
								</td>
								<td className="p-2 font-mono">
									{l.avisoNumbers.length > 0 ? l.avisoNumbers.join(" · ") : "—"}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.net)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.retention)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.toPay)}
								</td>
								<td className="p-2">
									{l.paidAt ? (
										<Badge variant="ok">
											{t("finance_payroll.status.paid", {
												date: formatShortDate(l.paidAt),
												name: l.paidByName ?? "—",
											})}
										</Badge>
									) : l.holdReason ? (
										<Badge variant="danger">
											{t("finance_payroll.status.held", {
												reason: l.holdReason,
											})}
										</Badge>
									) : request.status === "draft" ? (
										<span className="text-muted-foreground">—</span>
									) : (
										<Badge variant="warn">
											{t("finance_payroll.status.waiting")}
										</Badge>
									)}
									{l.askNote ? (
										<p className="mt-1 text-xs text-muted-foreground">
											{t("finance_payroll.asked", { note: l.askNote })}
										</p>
									) : null}
								</td>
							</tr>
						))}
						<tr className="border-t-2 font-semibold">
							<td className="p-2" colSpan={2}>
								{t("finance_payroll.total")}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(totals.net)}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(totals.retention)}
							</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(totals.toPay)}
							</td>
							<td className="p-2" />
						</tr>
					</tbody>
				</table>
			</div>
			<p className="text-xs text-muted-foreground">
				{t("finance_payroll.net_note")}
			</p>
			{hasD && (
				<p className="text-xs text-muted-foreground">
					{t("finance_payroll.d_note")}
				</p>
			)}
		</section>
	)
}

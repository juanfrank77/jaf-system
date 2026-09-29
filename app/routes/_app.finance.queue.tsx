import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { resolveContractorAccount } from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [
	{ title: "Packets in — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const docs = await db.jafInvoice.findMany({
		where: armAOpenWhere(),
		orderBy: { releasedToFinanceAt: "asc" },
		take: 200,
		select: {
			id: true,
			controlNumber: true,
			avisoNumber: true,
			releasedToFinanceAt: true,
			netPayable: true,
			contractorAccountCode: true,
			preCertSheets: {
				orderBy: { version: "desc" },
				take: 1,
				select: { sigSubcontractorName: true },
			},
			brigade: { select: { leadName: true, name: true } },
		},
	})
	const jobs = await Promise.all(
		docs.map(async (d) => ({
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			contractorLabel:
				d.preCertSheets[0]?.sigSubcontractorName ??
				d.brigade?.leadName ??
				d.brigade?.name ??
				null,
			netPayable: d.netPayable != null ? toNumberPrice(d.netPayable) : null,
			releasedAt: d.releasedToFinanceAt,
			// Not yet swept into a run, so resolved live for the row's badge —
			// this does NOT persist contractorAccountId (only generateRun does).
			accountResolved:
				(await resolveContractorAccount(d.contractorAccountCode)) !== null,
		})),
	)
	return { user, jobs }
}

export default function FinanceQueue({ loaderData }: Route.ComponentProps) {
	const { jobs } = loaderData
	const { t } = useTranslation()
	const newPackets = jobs.filter((j) => j.netPayable == null).length
	const awaitingPayroll = jobs.length
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("finance_queue.title")}</h1>
				<div className="flex gap-2 text-xs">
					<span className="bg-slate-100 px-3 py-1 rounded-full">
						{t("finance_queue.stat.new_packets", { count: newPackets })}
					</span>
					<span className="bg-slate-100 px-3 py-1 rounded-full">
						{t("finance_queue.stat.awaiting_payroll", {
							count: awaitingPayroll,
						})}
					</span>
				</div>
			</div>
			<p className="text-sm text-slate-500">{t("finance_queue.hint")}</p>
			{jobs.length === 0 ? (
				<p className="text-sm text-slate-400">{t("finance_queue.empty")}</p>
			) : (
				<div className="overflow-x-auto bg-white border rounded-lg">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-xs text-slate-500 text-left border-b">
								<th className="p-2">{t("finance_queue.col.work_order")}</th>
								<th className="p-2">{t("finance_queue.col.aviso")}</th>
								<th className="p-2">{t("finance_queue.col.contractor")}</th>
								<th className="p-2 text-right">
									{t("finance_queue.col.amount")}
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
									<td className="p-2 font-mono">
										<Link to={`/finance/pbcc/${r.id}`} className="underline">
											{r.controlNumber}
										</Link>
									</td>
									<td className="p-2">{r.avisoNumber ?? "—"}</td>
									<td className="p-2">{r.contractorLabel ?? "—"}</td>
									<td className="p-2 text-right">
										{r.netPayable == null ? "—" : formatMoney(r.netPayable)}
									</td>
									<td className="p-2 space-x-1">
										{!r.accountResolved && (
											<Badge variant="warn">
												{t("finance_queue.account_unmapped")}
											</Badge>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

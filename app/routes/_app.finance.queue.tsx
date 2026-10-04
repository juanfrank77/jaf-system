import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [
	{ title: "Payment request queue — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const docs = await db.jafInvoice.findMany({
		where: {
			releasedToFinanceAt: { not: null },
			status: { notIn: ["LC_REQUEST_GENERATED", "CANCELLED"] },
		},
		select: {
			id: true,
			controlNumber: true,
			avisoNumber: true,
			jafInvoiceLineTotal: true,
			releasedToFinanceAt: true,
			contractorAccountCode: true,
			brigade: { select: { name: true, leadName: true } },
			preCertSheets: {
				where: { supersededAt: null },
				select: {
					sigSubcontractorName: true,
					sigClaroAt: true,
					sigClaroScanPath: true,
				},
				take: 1,
			},
		},
		orderBy: { releasedToFinanceAt: "desc" },
		take: 200,
	})
	const rows = docs.map((d) => {
		const sheet = d.preCertSheets[0]
		return {
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			contractorName:
				sheet?.sigSubcontractorName ??
				d.brigade?.leadName ??
				d.brigade?.name ??
				"—",
			contractorCode: d.contractorAccountCode,
			amount: toNumberPrice(d.jafInvoiceLineTotal),
			releasedAt: d.releasedToFinanceAt,
			claroSigned: !!(sheet?.sigClaroAt || sheet?.sigClaroScanPath),
		}
	})
	const claroAcceptancePct =
		rows.length === 0
			? null
			: Math.round(
					(rows.filter((r) => r.claroSigned).length / rows.length) * 100,
				)
	return { user, rows, claroAcceptancePct }
}

export default function FinanceQueue({ loaderData }: Route.ComponentProps) {
	const { rows, claroAcceptancePct } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">{t("finance_queue.title")}</h1>
				{claroAcceptancePct != null && (
					<span className="text-xs bg-muted px-3 py-1 rounded-full">
						{t("finance_queue.claro_pct", { pct: claroAcceptancePct })}
					</span>
				)}
			</div>
			<p className="text-sm text-muted-foreground">{t("finance_queue.hint")}</p>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<div className="overflow-x-auto bg-card border rounded-lg">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-xs text-muted-foreground text-left border-b">
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
							{rows.map((r) => (
								<tr
									key={r.id}
									className="border-b last:border-0 hover:bg-muted/40"
								>
									<td className="p-2 font-mono">
										<Link to={`/finance/verify/${r.id}`} className="underline">
											{r.controlNumber}
										</Link>
									</td>
									<td className="p-2">{r.avisoNumber ?? "—"}</td>
									<td className="p-2">
										{r.contractorName}
										{r.contractorCode ? ` · ${r.contractorCode}` : ""}
									</td>
									<td className="p-2 text-right">{formatMoney(r.amount)}</td>
									<td className="p-2 space-x-1">
										<Badge variant="ok">{t("finance_queue.complete")}</Badge>
										{!r.claroSigned && (
											<Badge variant="warn">
												{t("finance_queue.no_claro_sig")}
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

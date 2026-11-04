import { useTranslation } from "react-i18next"
import type { BatchMoneyRow } from "~/lib/pbcc-wire.server"
import { formatMoney } from "~/lib/utils"

/** 100% sold against 80% received, per batch: nobody reads a batch as sold at 80%. */
export function BatchMoneyTable({ rows }: { rows: BatchMoneyRow[] }) {
	const { t } = useTranslation()
	if (rows.length === 0) return null
	return (
		<section className="space-y-2" data-testid="batch-money">
			<h2 className="font-semibold">{t("batch_money.title")}</h2>
			<div className="overflow-x-auto rounded-lg border bg-card">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-2">{t("batch_money.col.batch")}</th>
							<th className="p-2 text-right">{t("batch_money.col.sold")}</th>
							<th className="p-2 text-right">{t("batch_money.col.advance")}</th>
							<th className="p-2 text-right">
								{t("batch_money.col.received")}
							</th>
							<th className="p-2 text-right">{t("batch_money.col.held")}</th>
							<th className="p-2 text-right">{t("batch_money.col.fee")}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id} className="border-b last:border-0">
								<td className="p-2">
									{r.number
										? t("batch_money.batch", { number: r.number })
										: t("batch_money.open")}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(r.sold)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(r.advance)}
								</td>
								<td className="p-2 text-right font-mono">
									{r.received === null
										? "—"
										: `${r.receivedOn} · ${formatMoney(r.received)}`}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(r.held)}
								</td>
								<td className="p-2 text-right font-mono">
									{r.fee === null ? "—" : formatMoney(r.fee)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}

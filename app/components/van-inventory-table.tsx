import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"

type VanInventoryRow = {
	serviceCodeId: string
	label: string
	onVan: number
	par: number | null
}

function Section({
	heading,
	rows,
}: {
	heading: string
	rows: VanInventoryRow[]
}) {
	const { t } = useTranslation()
	return (
		<section className="space-y-1">
			<h2 className="text-sm font-medium">{heading}</h2>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-muted-foreground">
						<th className="px-3 py-1 font-medium">
							{t("van_view.item", "Item")}
						</th>
						<th className="px-3 py-1 text-right font-medium">
							{t("van_view.on_van", "On van")}
						</th>
						<th className="px-3 py-1 text-right font-medium">
							{t("van_view.par", "Par")}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{rows.map((r) => {
						const low = r.par != null && r.onVan < r.par
						return (
							<tr
								key={r.serviceCodeId}
								className={low ? "bg-status-warn-soft" : undefined}
							>
								<td className="px-3 py-2.5 text-sm">{r.label}</td>
								<td className="px-3 py-2.5 text-right text-sm tabular-nums">
									{r.onVan}
									{low && (
										<Badge variant="warn" className="ml-2">
											{t("van_view.low")}
										</Badge>
									)}
								</td>
								<td className="px-3 py-2.5 text-right text-sm text-muted-foreground tabular-nums">
									{r.par ?? "—"}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</section>
	)
}

export function VanInventoryTable({
	serialized,
	accessories,
	owedBack,
}: {
	serialized: VanInventoryRow[]
	accessories: VanInventoryRow[]
	owedBack: { serial: string; sinceDays: number }[]
}) {
	const { t } = useTranslation()

	return (
		<div className="space-y-6">
			{serialized.length === 0 && accessories.length === 0 && (
				<p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
					{t("van_view.empty")}
				</p>
			)}
			{serialized.length > 0 && (
				<Section heading={t("van_view.serialized")} rows={serialized} />
			)}
			{accessories.length > 0 && (
				<Section heading={t("van_view.accessories")} rows={accessories} />
			)}

			{owedBack.length > 0 && (
				<section className="space-y-1">
					<h2 className="text-sm font-medium">
						{t("van_view.owed_back", "Owed back")}
					</h2>
					<ul className="divide-y text-sm">
						{owedBack.map((o) => (
							<li key={o.serial} className="py-2">
								<span className="font-mono">{o.serial}</span> ·{" "}
								{o.sinceDays === 0
									? t("van_view.removed_today")
									: t("van_view.removed_days_ago", { count: o.sinceDays })}{" "}
								· {t("van_view.pending_scan_in")}
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	)
}

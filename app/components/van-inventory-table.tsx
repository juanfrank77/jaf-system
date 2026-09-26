import { useTranslation } from "react-i18next"

export type VanInventoryRow = {
	serviceCodeId: string
	label: string
	onVan: number
	par: number | null
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

	function Row(r: VanInventoryRow) {
		const low = r.par != null && r.onVan < r.par
		return (
			<tr key={r.serviceCodeId} className={low ? "bg-amber-50" : undefined}>
				<td className="px-3 py-2 text-sm">{r.label}</td>
				<td className="px-3 py-2 text-sm text-right">{r.onVan}</td>
				<td className="px-3 py-2 text-sm text-right text-slate-500">
					{r.par ?? "—"}
				</td>
			</tr>
		)
	}

	return (
		<div className="space-y-6">
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-slate-500">
						<th className="px-3 py-1 font-medium">
							{t("van_view.item", "Item")}
						</th>
						<th className="px-3 py-1 font-medium text-right">
							{t("van_view.on_van", "On van")}
						</th>
						<th className="px-3 py-1 font-medium text-right">
							{t("van_view.par", "Par")}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{serialized.map(Row)}
					{accessories.map(Row)}
				</tbody>
			</table>

			{owedBack.length > 0 && (
				<div>
					<h3 className="text-sm font-medium mb-1">
						{t("van_view.owed_back", "Owed back")}
					</h3>
					<ul className="text-sm space-y-1">
						{owedBack.map((o) => (
							<li key={o.serial}>
								{o.serial} — {o.sinceDays}d
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}

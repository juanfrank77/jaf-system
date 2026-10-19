import { useId } from "react"
import { useTranslation } from "react-i18next"
import type { BrigadeStockLine } from "~/lib/field-materials"

/**
 * Read-only list of what was used from the brigade's own stock. Tracked only:
 * never part of a billable total, the packet or the pre-cert sheet
 * (provisional ruling, pending Finance). Renders nothing when empty.
 */
export function BrigadeStockTracked({ lines }: { lines: BrigadeStockLine[] }) {
	const { t } = useTranslation()
	const headingId = useId()
	if (lines.length === 0) return null
	return (
		<section
			aria-labelledby={headingId}
			className="bg-card border rounded-lg p-4 space-y-2"
		>
			<h2 id={headingId} className="text-sm font-medium">
				{t("brigade_stock_tracked.heading")}
			</h2>
			<p className="text-xs text-muted-foreground">
				{t("brigade_stock_tracked.hint")}
			</p>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b">
						<th className="pb-1 font-normal">
							{t("brigade_stock_tracked.code")}
						</th>
						<th className="pb-1 font-normal">
							{t("brigade_stock_tracked.name")}
						</th>
						<th className="pb-1 font-normal text-right">
							{t("brigade_stock_tracked.qty")}
						</th>
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => (
						<tr key={l.claroCode || l.name} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1">{l.name}</td>
							<td className="py-1 text-right tabular-nums">
								{l.qty}
								{l.unit ? ` ${l.unit}` : ""}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}

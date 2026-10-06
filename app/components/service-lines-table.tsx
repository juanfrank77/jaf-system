import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "~/components/ui/input"
import type { ServiceLine } from "~/lib/service-lines"

/**
 * Read-only ordered/installed table. When `editableName` is given, the
 * Installed column becomes inputs and a hidden field carries the JSON.
 */
export function ServiceLinesTable({
	lines,
	installed,
	editableName,
	showDifference,
}: {
	lines: ServiceLine[]
	installed?: ServiceLine[]
	editableName?: string
	showDifference?: boolean
}) {
	const { t } = useTranslation()
	const initial = lines.map((l) => ({
		...l,
		qty:
			installed?.find((i) => i.serviceCodeId === l.serviceCodeId)?.qty ?? l.qty,
	}))
	const [rows, setRows] = useState<ServiceLine[]>(initial)

	function updateQty(index: number, raw: string) {
		const qty = Math.max(0, parseInt(raw, 10) || 0)
		setRows(rows.map((r, i) => (i === index ? { ...r, qty } : r)))
	}

	return (
		<div className="overflow-x-auto">
			{editableName && (
				<input type="hidden" name={editableName} value={JSON.stringify(rows)} />
			)}
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b">
						<th className="py-1">{t("service_picker.col_code")}</th>
						<th className="py-1">{t("service_picker.col_description")}</th>
						<th className="py-1 text-right">
							{t("service_picker.col_ordered")}
						</th>
						<th className="py-1 text-right">
							{t("service_picker.col_installed")}
						</th>
						{showDifference && (
							<th className="py-1 text-right">
								{t("service_picker.col_difference")}
							</th>
						)}
					</tr>
				</thead>
				<tbody>
					{lines.map((l, i) => {
						const installedQty = installed?.find(
							(x) => x.serviceCodeId === l.serviceCodeId,
						)?.qty
						const diff = installedQty === undefined ? 0 : installedQty - l.qty
						return (
							<tr key={l.serviceCodeId} className="border-b last:border-0">
								<td className="py-1 font-mono text-xs">{l.claroCode}</td>
								<td className="py-1">{l.name}</td>
								<td className="py-1 text-right">{l.qty}</td>
								<td className="py-1 text-right">
									{editableName ? (
										<Input
											type="number"
											min={0}
											value={rows[i].qty}
											className="w-20 ml-auto"
											onChange={(e) => updateQty(i, e.target.value)}
										/>
									) : (
										(installedQty ?? "—")
									)}
								</td>
								{showDifference && (
									<td
										className={
											diff === 0
												? "py-1 text-right text-status-ok"
												: "py-1 text-right font-medium text-status-warn"
										}
									>
										{diff === 0 ? "—" : diff > 0 ? `+${diff}` : diff}
									</td>
								)}
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

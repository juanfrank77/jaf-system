import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QtyStepper } from "~/components/ui/qty-stepper"
import type { ServiceLine } from "~/lib/service-lines"

/**
 * Read-only ordered/installed table. When `editableName` is given, the
 * Installed column becomes inputs and a hidden field carries the JSON.
 */
export function ServiceLinesTable({
	lines,
	installed,
	editableName,
}: {
	lines: ServiceLine[]
	installed?: ServiceLine[]
	editableName?: string
}) {
	const { t } = useTranslation()
	const initial = lines.map((l) => ({
		...l,
		qty:
			installed?.find((i) => i.serviceCodeId === l.serviceCodeId)?.qty ?? l.qty,
	}))
	const [rows, setRows] = useState<ServiceLine[]>(initial)

	function updateQty(index: number, qty: number) {
		setRows(rows.map((r, i) => (i === index ? { ...r, qty } : r)))
	}

	if (editableName) {
		// Phone layout: one row per service, code under the name and a
		// thumb-sized stepper for the installed quantity. No horizontal scroll.
		return (
			<div>
				<input type="hidden" name={editableName} value={JSON.stringify(rows)} />
				<div className="flex items-center justify-between border-b pb-1 text-xs text-muted-foreground">
					<span>{t("service_picker.col_description")}</span>
					<span>{t("service_picker.col_installed")}</span>
				</div>
				<ul>
					{lines.map((l, i) => {
						return (
							<li
								key={l.serviceCodeId}
								className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
							>
								<div className="min-w-0">
									<p className="text-sm font-medium leading-snug">{l.name}</p>
									<p className="font-mono text-xs text-muted-foreground">
										{l.claroCode}
									</p>
									<p className="text-xs text-muted-foreground">
										{t("service_picker.col_ordered")}: {l.qty}
									</p>
								</div>
								<QtyStepper
									value={rows[i].qty}
									onChange={(qty) => updateQty(i, qty)}
									label={l.name}
								/>
							</li>
						)
					})}
				</ul>
			</div>
		)
	}

	return (
		<div className="overflow-x-auto">
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
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => {
						const installedQty = installed?.find(
							(x) => x.serviceCodeId === l.serviceCodeId,
						)?.qty
						return (
							<tr key={l.serviceCodeId} className="border-b last:border-0">
								<td className="py-1 font-mono text-xs">{l.claroCode}</td>
								<td className="py-1">{l.name}</td>
								<td className="py-1 text-right">{l.qty}</td>
								<td className="py-1 text-right">{installedQty ?? "—"}</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

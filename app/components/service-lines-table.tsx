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

	function updateQty(index: number, qty: number) {
		setRows(rows.map((r, i) => (i === index ? { ...r, qty } : r)))
	}

	if (editableName) {
		// Phone layout: one row per service, code under the name, a thumb-sized
		// stepper for the installed quantity and an amber "+N / -N" when it
		// differs from what was ordered. No horizontal scroll.
		return (
			<div>
				<input type="hidden" name={editableName} value={JSON.stringify(rows)} />
				<div className="flex items-center justify-between border-b pb-1 text-xs text-muted-foreground">
					<span>{t("service_picker.col_description")}</span>
					<span>{t("service_picker.col_installed")}</span>
				</div>
				<ul>
					{lines.map((l, i) => {
						const diff = rows[i].qty - l.qty
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
										{diff !== 0 && (
											<span className="ml-2 rounded bg-status-warn-soft px-1.5 py-0.5 font-medium text-status-warn">
												{diff > 0 ? `+${diff}` : diff}
											</span>
										)}
									</p>
								</div>
								<QtyStepper
									value={rows[i].qty}
									onChange={(qty) => updateQty(i, qty)}
									label={l.name}
									invalid={diff !== 0}
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
						{showDifference && (
							<th className="py-1 text-right">
								{t("service_picker.col_difference")}
							</th>
						)}
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => {
						const installedQty = installed?.find(
							(x) => x.serviceCodeId === l.serviceCodeId,
						)?.qty
						const diff = installedQty === undefined ? 0 : installedQty - l.qty
						return (
							<tr key={l.serviceCodeId} className="border-b last:border-0">
								<td className="py-1 font-mono text-xs">{l.claroCode}</td>
								<td className="py-1">{l.name}</td>
								<td className="py-1 text-right">{l.qty}</td>
								<td className="py-1 text-right">{installedQty ?? "—"}</td>
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

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QtyStepper } from "~/components/ui/qty-stepper"
import { installedNotOrdered, type ServiceLine } from "~/lib/service-lines"

/** The small "Added in field" tag on a line the order did not have. */
export function AddedInFieldLabel() {
	const { t } = useTranslation()
	return (
		<span className="ml-1.5 inline-block rounded-md bg-status-info-soft px-1.5 py-0.5 align-middle text-xs font-medium text-status-info">
			{t("service_picker.added_in_field")}
		</span>
	)
}

/**
 * Read-only ordered/installed table. When `editableName` is given, the
 * Installed column becomes inputs and a hidden field carries the JSON.
 *
 * Installed lines the order does not have (added in the field) follow the
 * ordered ones with Ordered 0, so none is dropped by the join on the order.
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
	const extras = installedNotOrdered(lines, installed)
	const orderedQty = new Map(lines.map((l) => [l.serviceCodeId, l.qty]))
	const initial = [
		...lines.map((l) => ({
			...l,
			qty:
				installed?.find((i) => i.serviceCodeId === l.serviceCodeId)?.qty ??
				l.qty,
		})),
		...extras,
	]
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
					{rows.map((l, i) => {
						return (
							<li
								key={l.serviceCodeId}
								className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
							>
								<div className="min-w-0">
									<p className="text-sm font-medium leading-snug">
										{l.name}
										{l.addedInField && <AddedInFieldLabel />}
									</p>
									<p className="font-mono text-xs text-muted-foreground">
										{l.claroCode}
									</p>
									<p className="text-xs text-muted-foreground">
										{t("service_picker.col_ordered")}:{" "}
										{orderedQty.get(l.serviceCodeId) ?? 0}
									</p>
								</div>
								<QtyStepper
									value={l.qty}
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
					{extras.map((l) => (
						<tr key={l.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1">
								{l.name}
								{l.addedInField && <AddedInFieldLabel />}
							</td>
							<td className="py-1 text-right">0</td>
							<td className="py-1 text-right">{l.qty}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

import { useTranslation } from "react-i18next"
import type { MaterialLineItems } from "~/components/material-line-items"
import { ServiceLinesTable } from "~/components/service-lines-table"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import type { ServiceLine } from "~/lib/service-lines"

type MaterialLine = Parameters<typeof MaterialLineItems>[0]["initialItems"]
type MaterialServiceCode = Parameters<
	typeof MaterialLineItems
>[0]["serviceCodes"]

/** Json column → lines; tolerates null or a malformed non-array value. */
export function asLines<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : []
}

/** `preppedMaterials` stores the quantity as `preppedQty`; the viewer reads `qty`. */
export function preppedAsLines(value: unknown): MaterialLine {
	return asLines<{ serviceCodeId: string; preppedQty?: number }>(value).map(
		(l) => ({ serviceCodeId: l.serviceCodeId, qty: l.preppedQty ?? 0 }),
	) as MaterialLine
}

type MaterialColumnKey = "estimated" | "prepped" | "taken" | "used"

/**
 * One row per material, one column per stage, like the service items table:
 * a blank dash where a stage has no quantity for that material.
 */
function MaterialsTable({
	serviceCodes,
	columns,
}: {
	serviceCodes: MaterialServiceCode
	columns: readonly (readonly [MaterialColumnKey, MaterialLine])[]
}) {
	const { t } = useTranslation()
	const ids: string[] = []
	for (const [, items] of columns)
		for (const l of items ?? [])
			if (!ids.includes(l.serviceCodeId)) ids.push(l.serviceCodeId)
	if (ids.length === 0)
		return <p className="text-sm text-muted-foreground">—</p>
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm" data-testid="job-lines-materials">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b">
						<th className="py-1">{t("job_lines.col_code")}</th>
						<th className="py-1">{t("job_lines.col_material")}</th>
						{columns.map(([key]) => (
							<th key={key} className="py-1 text-right">
								{t(`job_lines.col.${key}`)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{ids.map((id) => {
						const code = serviceCodes.find((c) => c.id === id)
						return (
							<tr key={id} className="border-b last:border-0">
								<td className="py-1 font-mono text-xs">
									{code?.claroCode ?? "—"}
								</td>
								<td className="py-1">{code?.name ?? t("job_lines.unknown")}</td>
								{columns.map(([key, items]) => {
									const qty = items?.find((l) => l.serviceCodeId === id)?.qty
									return (
										<td
											key={key}
											data-testid={`job-lines-${key}`}
											className="py-1 text-right"
										>
											{qty === undefined
												? "—"
												: `${qty}${code?.unit ? ` ${code.unit}` : ""}`}
										</td>
									)
								})}
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

/**
 * Read-only view of what a work order asked for and what happened to it:
 * the ordered / installed service items, then the materials as Estimated,
 * Prepped, Taken and Used. Shown on the supervisor's Approve step only. No
 * prices: those stay with Finance's own screens.
 */
export function JobLinesCard({
	ordered,
	installed,
	estimated,
	prepped,
	taken,
	used,
	serviceCodes,
}: {
	ordered: ServiceLine[]
	installed: ServiceLine[]
	estimated: MaterialLine
	prepped: MaterialLine
	taken: MaterialLine
	used: MaterialLine
	serviceCodes: MaterialServiceCode
}) {
	const { t } = useTranslation()
	const columns = [
		["estimated", estimated],
		["prepped", prepped],
		["taken", taken],
		["used", used],
	] as const
	return (
		<Card data-testid="job-lines">
			<CardHeader>
				<span>{t("job_lines.title")}</span>
			</CardHeader>
			<CardContent className="space-y-4">
				<section className="space-y-1">
					<h3 className="text-xs font-medium text-muted-foreground">
						{t("job_lines.services")}
					</h3>
					{ordered.length > 0 ? (
						<ServiceLinesTable
							lines={ordered}
							installed={installed}
							showDifference
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("job_lines.none")}
						</p>
					)}
				</section>
				{
					<section className="space-y-1">
						<h3 className="text-xs font-medium text-muted-foreground">
							{t("job_lines.materials")}
						</h3>
						<MaterialsTable serviceCodes={serviceCodes} columns={columns} />
					</section>
				}
			</CardContent>
		</Card>
	)
}

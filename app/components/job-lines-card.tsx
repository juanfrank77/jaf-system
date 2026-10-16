import { useTranslation } from "react-i18next"
import { MaterialLineItems } from "~/components/material-line-items"
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

/**
 * Read-only view of what a work order asked for and what happened to it:
 * the ordered / installed service items, then the materials as Estimated,
 * Prepped, Taken and Used side by side. Shown on every supervisor and
 * Finance screen, so the two roles read the same lines when checking that an
 * order matches. No prices: those stay with Finance's own screens.
 */
export function JobLinesCard({
	ordered,
	installed,
	estimated,
	prepped,
	taken,
	used,
	serviceCodes,
	showMaterials = true,
}: {
	ordered: ServiceLine[]
	installed: ServiceLine[]
	estimated: MaterialLine
	prepped: MaterialLine
	taken: MaterialLine
	used: MaterialLine
	serviceCodes: MaterialServiceCode
	/** Off where the page already lists the materials itself. */
	showMaterials?: boolean
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
				<span>
					{t(showMaterials ? "job_lines.title" : "job_lines.title_services")}
				</span>
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
				{showMaterials && (
					<section className="space-y-1">
						<h3 className="text-xs font-medium text-muted-foreground">
							{t("job_lines.materials")}
						</h3>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{columns.map(([key, items]) => (
								<div
									key={key}
									data-testid={`job-lines-${key}`}
									className="rounded-lg border border-border p-3"
								>
									<p className="mb-1 text-xs text-muted-foreground">
										{t(`job_lines.col.${key}`)}
									</p>
									{items && items.length > 0 ? (
										<MaterialLineItems
											serviceCodes={serviceCodes}
											initialItems={items}
											estimatedItems={key === "taken" ? estimated : undefined}
											showPrice={false}
											readOnly
										/>
									) : (
										<p className="text-sm text-muted-foreground">—</p>
									)}
								</div>
							))}
						</div>
					</section>
				)}
			</CardContent>
		</Card>
	)
}

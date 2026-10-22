import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Input } from "~/components/ui/input"
import type { FieldMaterialRow } from "~/lib/field-materials"
import {
	MATERIAL_SOURCES,
	type MaterialSource,
	sourceLabelKey,
} from "~/lib/material-source"

/** A stored Field row plus what the table shows beside it (never a price). */
export type FieldMaterialsTableRow = FieldMaterialRow & {
	claroCode: string
	name: string
	unit?: string | null
	estimated: number
	/** Issued at pickup and signed for. */
	signed: number
}

function plain(row: FieldMaterialsTableRow): FieldMaterialRow {
	return {
		serviceCodeId: row.serviceCodeId,
		used: row.used,
		returned: row.returned,
		source: row.source,
	}
}

function qty(value: string): number {
	const n = Number(value)
	return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * The Field step's one materials table (spec "Step 3 · Field"): code,
 * material, estimated, issued (signed), used, returned and where the used
 * material came from. Pure: the caller owns the rows and gets each edited
 * row back as the stored shape.
 *
 * On a phone the same markup lays out as one card per material (name on top,
 * Used / Returned side by side, Source below) so nothing hides behind a side
 * scroll; from `md` up it is the table.
 */
export function FieldMaterialsTable({
	rows,
	onChange,
	onRemove,
}: {
	rows: FieldMaterialsTableRow[]
	onChange: (index: number, row: FieldMaterialRow) => void
	/** Rows the crew added (nothing signed out for them) can be taken back off. */
	onRemove: (index: number) => void
}) {
	const { t } = useTranslation()
	const edit = (i: number, patch: Partial<FieldMaterialRow>) =>
		onChange(i, { ...plain(rows[i]), ...patch })
	return (
		<div className="md:overflow-x-auto">
			<table
				data-testid="field-materials"
				className="w-full text-sm max-md:block"
			>
				<thead className="max-md:hidden">
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th className="py-1.5 pr-2">{t("docs_field.materials.code")}</th>
						<th className="py-1.5 pr-2">
							{t("docs_field.materials.material")}
						</th>
						<th className="py-1.5 pr-2 text-right">
							{t("docs_field.materials.estimated")}
						</th>
						<th className="py-1.5 pr-2 text-right">
							{t("docs_field.materials.signed")}
						</th>
						<th className="py-1.5 pr-2">{t("docs_field.materials.used")}</th>
						<th className="py-1.5 pr-2">
							{t("docs_field.materials.returned")}
						</th>
						<th className="py-1.5 pr-2">{t("docs_field.materials.source")}</th>
						<th className="py-1.5" />
					</tr>
				</thead>
				<tbody className="tabular-nums max-md:block max-md:space-y-3">
					{rows.map((r, i) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are only appended, never reordered, and code+source can repeat while being edited
							key={`${r.serviceCodeId}-${r.source}-${i}`}
							className="max-md:relative max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-lg max-md:border max-md:border-border max-md:p-3 md:border-b md:last:border-0"
						>
							<td className="py-1.5 pr-2 font-mono text-xs max-md:col-span-2 max-md:block max-md:py-0 max-md:text-muted-foreground">
								{r.claroCode}
							</td>
							<td className="py-1.5 pr-2 max-md:col-span-2 max-md:block max-md:py-0 max-md:pr-10 max-md:font-semibold">
								{r.name}
								{r.unit && (
									<span className="ml-1 text-xs text-muted-foreground">
										({r.unit})
									</span>
								)}
							</td>
							<td
								data-label={t("docs_field.materials.estimated")}
								className={`py-1.5 pr-2 text-right max-md:block max-md:py-0 max-md:text-left ${"before:mb-0.5 before:block before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none"}`}
							>
								{r.estimated}
							</td>
							<td
								data-label={t("docs_field.materials.signed")}
								className={`py-1.5 pr-2 text-right max-md:block max-md:py-0 max-md:text-left ${"before:mb-0.5 before:block before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none"}`}
							>
								{r.signed}
							</td>
							<td
								data-label={t("docs_field.materials.used")}
								className={`py-1.5 pr-2 max-md:block max-md:py-0 ${"before:mb-0.5 before:block before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none"}`}
							>
								<Input
									type="number"
									min={0}
									inputMode="decimal"
									className="field-required w-20 max-md:h-10 max-md:w-full"
									aria-label={t("docs_field.materials.used")}
									value={r.used}
									onChange={(e) => edit(i, { used: qty(e.target.value) })}
								/>
							</td>
							<td
								data-label={t("docs_field.materials.returned")}
								className={`py-1.5 pr-2 max-md:block max-md:py-0 ${"before:mb-0.5 before:block before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none"}`}
							>
								<Input
									type="number"
									min={0}
									inputMode="decimal"
									className="w-20 max-md:h-10 max-md:w-full"
									aria-label={t("docs_field.materials.returned")}
									value={r.returned}
									onChange={(e) => edit(i, { returned: qty(e.target.value) })}
								/>
							</td>
							<td
								data-label={t("docs_field.materials.source")}
								className={`py-1.5 pr-2 max-md:col-span-2 max-md:block max-md:py-0 ${"before:mb-0.5 before:block before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none"}`}
							>
								<select
									aria-label={t("docs_field.materials.source")}
									className="field-required h-8 rounded-lg border border-input px-2 text-sm max-md:h-10 max-md:w-full"
									value={r.source}
									onChange={(e) =>
										edit(i, { source: e.target.value as MaterialSource })
									}
								>
									{MATERIAL_SOURCES.map((value) => (
										<option key={value} value={value}>
											{t(sourceLabelKey(value))}
										</option>
									))}
								</select>
							</td>
							<td className="py-1.5 max-md:absolute max-md:top-2 max-md:right-2 max-md:py-0">
								{r.signed === 0 && (
									<button
										type="button"
										onClick={() => onRemove(i)}
										aria-label={`${t("docs_field.materials.remove")} ${r.claroCode}`}
										className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger"
									>
										<HugeiconsIcon
											icon={Cancel01Icon}
											strokeWidth={2}
											className="size-4"
										/>
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

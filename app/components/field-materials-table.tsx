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
 */
export function FieldMaterialsTable({
	rows,
	onChange,
}: {
	rows: FieldMaterialsTableRow[]
	onChange: (index: number, row: FieldMaterialRow) => void
}) {
	const { t } = useTranslation()
	const edit = (i: number, patch: Partial<FieldMaterialRow>) =>
		onChange(i, { ...plain(rows[i]), ...patch })
	return (
		<div className="overflow-x-auto">
			<table data-testid="field-materials" className="w-full text-sm">
				<thead>
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
						<th className="py-1.5">{t("docs_field.materials.source")}</th>
					</tr>
				</thead>
				<tbody className="tabular-nums">
					{rows.map((r, i) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are only appended, never reordered, and code+source can repeat while being edited
							key={`${r.serviceCodeId}-${r.source}-${i}`}
							className="border-b last:border-0"
						>
							<td className="py-1.5 pr-2 font-mono text-xs">{r.claroCode}</td>
							<td className="py-1.5 pr-2">
								{r.name}
								{r.unit && (
									<span className="ml-1 text-xs text-muted-foreground">
										({r.unit})
									</span>
								)}
							</td>
							<td className="py-1.5 pr-2 text-right">{r.estimated}</td>
							<td className="py-1.5 pr-2 text-right">{r.signed}</td>
							<td className="py-1.5 pr-2">
								<Input
									type="number"
									min={0}
									inputMode="decimal"
									className="field-required w-20"
									aria-label={t("docs_field.materials.used")}
									value={r.used}
									onChange={(e) => edit(i, { used: qty(e.target.value) })}
								/>
							</td>
							<td className="py-1.5 pr-2">
								<Input
									type="number"
									min={0}
									inputMode="decimal"
									className="w-20"
									aria-label={t("docs_field.materials.returned")}
									value={r.returned}
									onChange={(e) => edit(i, { returned: qty(e.target.value) })}
								/>
							</td>
							<td className="py-1.5">
								<select
									aria-label={t("docs_field.materials.source")}
									className="field-required h-8 rounded-lg border border-input px-2 text-sm"
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
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

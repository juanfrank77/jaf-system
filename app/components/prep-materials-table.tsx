import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Fragment, useState } from "react"
import { useTranslation } from "react-i18next"
import { CodeSearchSelect } from "~/components/code-search-select"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { cn } from "~/lib/utils"

/** One line of the warehouse's prep list, as the Prep action stores it. */
export type PrepRow = {
	_key: string
	serviceCodeId: string
	/** What the supervisor requested; 0 for a material the warehouse added. */
	estimatedQty: number
	preppedQty: number
	substitutedWith: string | null
	missing: boolean
	notes: string
}

export type PrepAvailability = {
	available: number
	countUnit: string | null
	stockUnit: string | null
	derivedAvailable: number | null
}

type PrepCode = {
	id: string
	claroCode: string
	name: string
	unit?: string | null
}

const COLUMNS = 7

/**
 * The warehouse's prep list: one row per requested material, with what was
 * requested next to what is in stock and a box for what gets prepped, so the
 * list can be scanned at a glance. Replace-with, Out of stock and a note open
 * under a row on demand. Pure: the caller owns the rows.
 */
export function PrepMaterialsTable({
	rows,
	codes,
	availability,
	onChange,
	onRemove,
}: {
	rows: PrepRow[]
	codes: PrepCode[]
	availability: Record<string, PrepAvailability | undefined>
	onChange: (index: number, patch: Partial<PrepRow>) => void
	onRemove: (index: number) => void
}) {
	const { t } = useTranslation()
	const codeOf = new Map(codes.map((c) => [c.id, c]))
	// A row already carrying a flag, a replacement or a note starts open, and so
	// does one the warehouse just added (it needs its material picked).
	const [open, setOpen] = useState<Set<string>>(
		() =>
			new Set(
				rows
					.filter(
						(r) =>
							r.missing ||
							r.substitutedWith ||
							r.notes ||
							r.serviceCodeId === "",
					)
					.map((r) => r._key),
			),
	)
	const setRowOpen = (key: string, isOpen: boolean) =>
		setOpen((prev) => {
			const next = new Set(prev)
			if (isOpen) next.add(key)
			else next.delete(key)
			return next
		})

	return (
		<div className="overflow-x-auto">
			<table data-testid="prep-materials" className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th className="py-1.5 pr-2">{t("docs_prep.col.code")}</th>
						<th className="py-1.5 pr-2">{t("docs_prep.col.material")}</th>
						<th className="py-1.5 pr-2 text-right">
							{t("docs_prep.col.requested")}
						</th>
						<th className="py-1.5 pr-2 text-right">
							{t("docs_prep.col.in_stock")}
						</th>
						<th className="py-1.5 pr-2">{t("docs_prep.col.prepped")}</th>
						<th className="py-1.5 pr-2">{t("docs_prep.col.status")}</th>
						<th className="py-1.5" />
					</tr>
				</thead>
				<tbody className="tabular-nums">
					{rows.map((row, index) => {
						const code = codeOf.get(row.serviceCodeId)
						const avail = availability[row.serviceCodeId]
						const unit = code?.unit ?? ""
						const requested = row.estimatedQty
						const short = Math.max(0, requested - row.preppedQty)
						const lowStock =
							!!avail && requested > 0 && avail.available < requested
						const isOpen = open.has(row._key)
						const taken = new Set(
							rows
								.filter((_, i) => i !== index)
								.map((r) => r.serviceCodeId)
								.filter(Boolean),
						)
						const replacements = codes.filter(
							(c) => c.id !== row.serviceCodeId && !taken.has(c.id),
						)
						const tint = row.missing
							? "bg-status-danger-soft"
							: short > 0
								? "bg-status-warn-soft"
								: ""
						return (
							<Fragment key={row._key}>
								<tr
									className={cn("border-b", !isOpen && "last:border-0", tint)}
								>
									<td className="py-1.5 pr-2 pl-1 font-mono text-xs">
										{code?.claroCode ?? "—"}
									</td>
									<td className="py-1.5 pr-2">
										{requested === 0 ? (
											// A material the warehouse added stays changeable, so a
											// wrong pick can be corrected or the line removed.
											<CodeSearchSelect
												items={codes.filter((c) => !taken.has(c.id))}
												selected={code ?? null}
												placeholder={t("docs_prep.select_material")}
												onPick={(c) =>
													onChange(index, {
														serviceCodeId: c.id,
														substitutedWith: null,
													})
												}
											/>
										) : (
											(code?.name ?? row.serviceCodeId)
										)}
									</td>
									<td className="py-1.5 pr-2 text-right">
										{requested > 0 ? `${requested} ${unit}` : "—"}
									</td>
									<td
										className={cn(
											"py-1.5 pr-2 text-right",
											lowStock && "font-medium text-status-warn",
										)}
									>
										{avail
											? `${avail.available} ${avail.countUnit ?? unit}`
											: "—"}
									</td>
									<td className="py-1.5 pr-2">
										<Input
											type="number"
											min={0}
											inputMode="numeric"
											className="w-20"
											aria-label={`${t("docs_prep.col.prepped")} ${code?.claroCode ?? ""}`.trim()}
											value={row.preppedQty}
											onChange={(e) => {
												const qty = Math.max(
													0,
													parseInt(e.target.value, 10) || 0,
												)
												// Nothing prepped is the same as out of stock.
												onChange(index, { preppedQty: qty, missing: qty === 0 })
												if (qty === 0) setRowOpen(row._key, true)
											}}
										/>
									</td>
									<td className="py-1.5 pr-2 text-xs font-medium">
										{row.missing ? (
											<span className="text-status-danger">
												{t("docs_prep.status.out")}
											</span>
										) : short > 0 ? (
											<span className="text-status-warn">
												{t("docs_prep.status.short", { count: short })}
											</span>
										) : (
											<span className="text-status-ok">
												✓ {t("docs_prep.status.ok")}
											</span>
										)}
									</td>
									<td className="py-1.5 pr-1 text-right">
										<div className="flex items-center justify-end gap-1">
											{requested === 0 && (
												<button
													type="button"
													onClick={() => onRemove(index)}
													aria-label={t("docs_prep.remove_line")}
													className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger"
												>
													<HugeiconsIcon
														icon={Cancel01Icon}
														strokeWidth={2}
														className="size-4"
													/>
												</button>
											)}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-expanded={isOpen}
												onClick={() => setRowOpen(row._key, !isOpen)}
											>
												{isOpen ? t("docs_prep.less") : t("docs_prep.more")}
											</Button>
										</div>
									</td>
								</tr>
								{isOpen && (
									<tr
										data-testid="prep-row-extras"
										className={cn("border-b last:border-0", tint)}
									>
										<td colSpan={COLUMNS} className="px-1 pb-3">
											<div className="flex flex-wrap items-end gap-x-4 gap-y-2">
												<div className="flex items-center gap-2">
													<Checkbox
														id={`out-${row._key}`}
														checked={row.missing}
														onCheckedChange={(checked: boolean) =>
															onChange(
																index,
																checked
																	? { missing: true, preppedQty: 0 }
																	: {
																			missing: false,
																			preppedQty: requested || 1,
																		},
															)
														}
													/>
													<Label
														htmlFor={`out-${row._key}`}
														className="text-sm"
													>
														{t("docs_prep.out_of_stock")}
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<Label
														htmlFor={`replace-${row._key}`}
														className="text-xs text-muted-foreground"
													>
														{t("docs_prep.replace_with")}
													</Label>
													<CodeSearchSelect
														items={replacements}
														selected={
															codeOf.get(row.substitutedWith ?? "") ?? null
														}
														placeholder={t("docs_prep.replace_placeholder")}
														label={t("docs_prep.replace_with")}
														onPick={(c) =>
															onChange(index, { substitutedWith: c.id })
														}
														onClear={() =>
															onChange(index, { substitutedWith: null })
														}
													/>
												</div>
												<div className="flex min-w-48 flex-1 items-center gap-2">
													<Label
														htmlFor={`note-${row._key}`}
														className="text-xs text-muted-foreground"
													>
														{t("docs_prep.line_notes")}
													</Label>
													<Input
														id={`note-${row._key}`}
														value={row.notes}
														placeholder={t("docs_prep.line_notes_placeholder")}
														onChange={(e) =>
															onChange(index, { notes: e.target.value })
														}
													/>
												</div>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => onRemove(index)}
												>
													{t("docs_prep.remove_line")}
												</Button>
											</div>
										</td>
									</tr>
								)}
							</Fragment>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

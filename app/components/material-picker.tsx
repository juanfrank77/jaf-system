import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "~/components/ui/input"

type Material = {
	id: string
	claroCode: string
	name: string
	unit: string | null
	unitPrice?: number
}
type Line = { serviceCodeId: string; qty: number }

/**
 * Materials the warehouse should prep for a work order: a searchable picker
 * over the material catalog plus a table, laid out like the service-codes
 * block. Focusing the search field lists every active material (scrollable);
 * typing narrows it by name or code. Posts the same `[{ serviceCodeId, qty }]` JSON as MaterialLineItems.
 */
export function MaterialPicker({
	materials,
	initialItems = [],
	name = "materials",
}: {
	materials: Material[]
	initialItems?: Line[]
	name?: string
}) {
	const { t } = useTranslation()
	const [lines, setLines] = useState<Line[]>(initialItems)
	const [query, setQuery] = useState("")
	const [open, setOpen] = useState(false)

	const term = query.trim().toLowerCase()
	const taken = new Set(lines.map((l) => l.serviceCodeId))
	const available = materials.filter((m) => !taken.has(m.id))
	const matches = term
		? available.filter(
				(m) =>
					m.claroCode.startsWith(term) || m.name.toLowerCase().includes(term),
			)
		: available

	const setQty = (id: string, qty: number) =>
		setLines(lines.map((l) => (l.serviceCodeId === id ? { ...l, qty } : l)))

	return (
		<div className="space-y-2">
			<input type="hidden" name={name} value={JSON.stringify(lines)} />
			<Input
				type="search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value)
					setOpen(true)
				}}
				onFocus={() => setOpen(true)}
				onClick={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
				placeholder={t("material_picker.search_placeholder")}
				aria-label={t("material_picker.search_placeholder")}
			/>
			{open && (
				// biome-ignore lint/a11y/noStaticElementInteractions: keeps focus in the search field while the list (or its scrollbar) is pressed, so the blur handler doesn't close it before the click lands
				<div
					onMouseDown={(e) => e.preventDefault()}
					className="max-h-64 overflow-y-auto rounded-lg border bg-card text-sm"
				>
					{matches.length === 0 ? (
						<p className="p-2 text-muted-foreground">
							{t("material_picker.no_results")}
						</p>
					) : (
						<ul>
							{matches.map((m) => (
								<li key={m.id}>
									<button
										type="button"
										onClick={() => {
											setLines([...lines, { serviceCodeId: m.id, qty: 1 }])
											setQuery("")
											setOpen(false)
										}}
										className="flex w-full items-center gap-3 px-2 py-1.5 text-left hover:bg-muted"
									>
										<span className="font-mono text-xs text-muted-foreground">
											{m.claroCode}
										</span>
										<span className="flex-1">{m.name}</span>
										{m.unit && (
											<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
												{m.unit}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
					<p className="border-t px-2 py-1 text-xs text-muted-foreground">
						{t("material_picker.results_count", {
							shown: matches.length,
							total: available.length,
						})}
					</p>
				</div>
			)}
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
							<th className="px-2 py-1.5">{t("material_picker.col_code")}</th>
							<th className="px-2 py-1.5">
								{t("material_picker.col_description")}
							</th>
							<th className="px-2 py-1.5 text-right">
								{t("material_picker.col_unit")}
							</th>
							<th className="px-2 py-1.5 text-right">
								{t("material_picker.col_qty")}
							</th>
							<th className="w-12" />
						</tr>
					</thead>
					<tbody>
						{lines.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-2 py-3 text-xs text-muted-foreground"
								>
									{t("material_picker.empty")}
								</td>
							</tr>
						)}
						{lines.map((l) => {
							const m = materials.find((x) => x.id === l.serviceCodeId)
							return (
								<tr key={l.serviceCodeId} className="border-b last:border-0">
									<td className="px-2 py-1.5 font-mono text-xs">
										{m?.claroCode ?? "—"}
									</td>
									<td className="px-2 py-1.5">{m?.name ?? "—"}</td>
									<td className="px-2 py-1.5 text-right font-mono text-xs">
										{m?.unit ?? "—"}
									</td>
									<td className="px-2 py-1.5 text-right">
										<Input
											type="number"
											min={1}
											value={l.qty || ""}
											aria-label={t("material_picker.col_qty")}
											onChange={(e) =>
												setQty(
													l.serviceCodeId,
													parseInt(e.target.value, 10) || 0,
												)
											}
											onBlur={() => l.qty < 1 && setQty(l.serviceCodeId, 1)}
											className="ml-auto w-20"
										/>
									</td>
									<td className="px-2 py-1.5 text-right">
										<button
											type="button"
											onClick={() =>
												setLines(
													lines.filter(
														(x) => x.serviceCodeId !== l.serviceCodeId,
													),
												)
											}
											aria-label={t("material_line_items.remove")}
											className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger"
										>
											<HugeiconsIcon
												icon={Cancel01Icon}
												strokeWidth={2}
												className="size-4"
											/>
										</button>
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</div>
	)
}

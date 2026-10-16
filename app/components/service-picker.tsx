import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Input } from "~/components/ui/input"
import { type ServiceLine, splitServiceSuffix } from "~/lib/service-lines"
import { formatMoney } from "~/lib/utils"

type Result = {
	id: string
	claroCode: string
	name: string
	accountCode: string | null
	unit: string | null
	/** Absent for roles that never see money. */
	unitPrice?: number
}

export function ServicePicker({
	name = "serviceLines",
	initialLines = [],
	initialMeta = {},
	showPrices = true,
}: {
	name?: string
	/** False for roles that never see money: no price, line amount or subtotal. */
	showPrices?: boolean
	initialLines?: ServiceLine[]
	/** Catalog unit/price for the initial lines, so a saved table shows prices. */
	initialMeta?: Record<string, { unit: string | null; unitPrice?: number }>
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ results: Result[]; total: number }>()
	const [query, setQuery] = useState("")
	const [lines, setLines] = useState<ServiceLine[]>(initialLines)
	// Catalog unit/price for display only: the persisted ServiceLine stays
	// price-free. Callers supply it for saved lines; added lines get it here.
	const [meta, setMeta] =
		useState<Record<string, { unit: string | null; unitPrice?: number }>>(
			initialMeta,
		)

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable; re-run on query only
	useEffect(() => {
		if (query.trim().length < 2) return
		const handle = setTimeout(() => {
			fetcher.load(`/api/service-codes?q=${encodeURIComponent(query.trim())}`)
		}, 200)
		return () => clearTimeout(handle)
	}, [query])

	const results = query.trim().length >= 2 ? (fetcher.data?.results ?? []) : []
	const total = fetcher.data?.total ?? 0
	// Only ambiguous when same-description results sit on different accounts.
	const accountsByName = results.reduce<Record<string, Set<string>>>(
		(acc, r) => {
			const set = acc[r.name] ?? new Set<string>()
			set.add(r.accountCode ?? "")
			acc[r.name] = set
			return acc
		},
		{},
	)

	function add(r: Result) {
		if (lines.some((l) => l.serviceCodeId === r.id)) return
		setLines([
			...lines,
			{
				serviceCodeId: r.id,
				claroCode: r.claroCode,
				accountCode: r.accountCode,
				name: r.name,
				qty: 1,
			},
		])
		setMeta({ ...meta, [r.id]: { unit: r.unit, unitPrice: r.unitPrice } })
		setQuery("")
	}
	function setQty(id: string, qty: number) {
		setLines(lines.map((l) => (l.serviceCodeId === id ? { ...l, qty } : l)))
	}
	const priced =
		showPrices &&
		lines.every((l) => meta[l.serviceCodeId]?.unitPrice !== undefined)
	const subtotal = lines.reduce(
		(sum, l) => sum + l.qty * (meta[l.serviceCodeId]?.unitPrice ?? 0),
		0,
	)
	function remove(id: string) {
		setLines(lines.filter((l) => l.serviceCodeId !== id))
	}

	return (
		<div className="space-y-2">
			<input type="hidden" name={name} value={JSON.stringify(lines)} />
			<Input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t("service_picker.search_placeholder")}
				aria-label={t("service_picker.search_placeholder")}
			/>
			{query.trim().length >= 2 && (
				<div className="border rounded-lg bg-card max-h-64 overflow-y-auto text-sm">
					{results.length === 0 ? (
						<p className="p-2 text-muted-foreground">
							{t("service_picker.no_results")}
						</p>
					) : (
						<ul>
							{results.map((r) => (
								<li key={r.id}>
									<button
										type="button"
										onClick={() => add(r)}
										className="w-full text-left px-2 py-1.5 hover:bg-muted flex items-center gap-3"
									>
										<span className="font-mono text-xs text-muted-foreground">
											{r.claroCode}
										</span>
										<span className="flex-1">
											{splitServiceSuffix(r.name).base}
										</span>
										<span className="font-mono text-xs text-muted-foreground">
											{splitServiceSuffix(r.name).suffix}
										</span>
										<span className="flex shrink-0 items-center gap-1.5 text-xs">
											<span className="rounded-md bg-status-warn-soft px-1.5 py-0.5 font-medium text-status-warn">
												{t("service_picker.account")} {r.accountCode ?? "—"}
											</span>
											<span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
												{r.unit ?? "—"}
												{showPrices && r.unitPrice !== undefined
													? ` · ${formatMoney(r.unitPrice)}`
													: ""}
											</span>
										</span>
									</button>
									{accountsByName[r.name].size > 1 && (
										<p className="px-2 pb-1 text-xs text-status-warn">
											{t("service_picker.same_description_hint")}
										</p>
									)}
								</li>
							))}
						</ul>
					)}
					<p className="px-2 py-1 text-xs text-muted-foreground border-t">
						{t("service_picker.results_count", {
							shown: results.length,
							total,
						})}
					</p>
				</div>
			)}
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
							<th className="px-2 py-1.5">{t("service_picker.col_code")}</th>
							<th className="px-2 py-1.5">
								{t("service_picker.col_description")}
							</th>
							<th className="px-2 py-1.5">{t("service_picker.col_type")}</th>
							<th className="px-2 py-1.5">{t("service_picker.col_account")}</th>
							<th className="px-2 py-1.5 text-right">
								{t("service_picker.col_qty")}
							</th>
							<th className="px-2 py-1.5 text-right">
								{t("service_picker.col_unit")}
							</th>
							{showPrices && (
								<>
									<th className="px-2 py-1.5 text-right">
										{t("service_picker.col_unit_price")}
									</th>
									<th className="px-2 py-1.5 text-right">
										{t("service_picker.col_line")}
									</th>
								</>
							)}
							<th className="w-12" />
						</tr>
					</thead>
					<tbody>
						{lines.length === 0 && (
							<tr>
								<td
									colSpan={showPrices ? 9 : 7}
									className="px-2 py-3 text-xs text-muted-foreground"
								>
									{t("service_picker.none_selected")}
								</td>
							</tr>
						)}
						{lines.map((l) => {
							const m = meta[l.serviceCodeId]
							return (
								<tr key={l.serviceCodeId} className="border-b last:border-0">
									<td className="px-2 py-1.5 font-mono text-xs">
										{l.claroCode}
									</td>
									<td className="px-2 py-1.5">
										{splitServiceSuffix(l.name).base}
									</td>
									<td className="px-2 py-1.5 font-mono text-xs">
										{splitServiceSuffix(l.name).suffix ?? "—"}
									</td>
									<td className="px-2 py-1.5 font-mono text-xs">
										{l.accountCode ?? "—"}
									</td>
									<td className="px-2 py-1.5 text-right">
										<Input
											type="number"
											min={1}
											value={l.qty}
											aria-label={t("service_picker.qty")}
											onChange={(e) =>
												setQty(
													l.serviceCodeId,
													Math.max(1, parseInt(e.target.value, 10) || 1),
												)
											}
											className="ml-auto w-20"
										/>
									</td>
									<td className="px-2 py-1.5 text-right font-mono text-xs">
										{m ? (m.unit ?? "—") : "—"}
									</td>
									{showPrices && (
										<>
											<td className="px-2 py-1.5 text-right">
												{m?.unitPrice !== undefined
													? formatMoney(m.unitPrice)
													: "—"}
											</td>
											<td className="px-2 py-1.5 text-right font-medium">
												{m?.unitPrice !== undefined
													? formatMoney(l.qty * m.unitPrice)
													: "—"}
											</td>
										</>
									)}
									<td className="px-2 py-1.5 text-right">
										<button
											type="button"
											onClick={() => remove(l.serviceCodeId)}
											className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger"
											aria-label={t("service_picker.remove")}
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
					{lines.length > 0 && priced && (
						<tfoot>
							<tr className="border-t bg-muted/40 font-semibold">
								<td colSpan={6} className="px-2 py-1.5 text-right">
									{t("service_picker.subtotal")}
								</td>
								<td className="px-2 py-1.5 text-right">
									{formatMoney(subtotal)}
								</td>
								<td />
							</tr>
						</tfoot>
					)}
				</table>
			</div>
		</div>
	)
}

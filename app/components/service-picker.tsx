import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Input } from "~/components/ui/input"
import type { ServiceLine } from "~/lib/service-lines"

type Result = {
	id: string
	claroCode: string
	name: string
	accountCode: string | null
	unit: string | null
	unitPrice: number
}

export function ServicePicker({
	name = "serviceLines",
	initialLines = [],
}: {
	name?: string
	initialLines?: ServiceLine[]
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ results: Result[]; total: number }>()
	const [query, setQuery] = useState("")
	const [lines, setLines] = useState<ServiceLine[]>(initialLines)

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
	const nameCounts = results.reduce<Record<string, number>>((acc, r) => {
		acc[r.name] = (acc[r.name] ?? 0) + 1
		return acc
	}, {})

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
		setQuery("")
	}
	function setQty(id: string, qty: number) {
		setLines(lines.map((l) => (l.serviceCodeId === id ? { ...l, qty } : l)))
	}
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
										<span className="flex-1">{r.name}</span>
										<span className="text-xs text-muted-foreground">
											{t("service_picker.account")} {r.accountCode ?? "—"} ·{" "}
											{r.unit ?? "—"} · ${r.unitPrice.toFixed(2)}
										</span>
									</button>
									{nameCounts[r.name] > 1 && (
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
			<div className="border rounded-lg p-2 space-y-1">
				<p className="text-xs font-medium text-muted-foreground">
					{t("service_picker.selected_heading")}
				</p>
				{lines.length === 0 && (
					<p className="text-xs text-muted-foreground">
						{t("service_picker.none_selected")}
					</p>
				)}
				{lines.map((l) => (
					<div
						key={l.serviceCodeId}
						className="flex items-center gap-2 text-sm"
					>
						<span className="font-mono text-xs text-muted-foreground">
							{l.claroCode}
						</span>
						<span className="flex-1">{l.name}</span>
						<span className="text-xs text-muted-foreground">
							{l.accountCode ?? "—"}
						</span>
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
							className="w-20"
						/>
						<button
							type="button"
							onClick={() => remove(l.serviceCodeId)}
							className="text-muted-foreground hover:text-status-danger"
							aria-label={t("service_picker.remove")}
						>
							×
						</button>
					</div>
				))}
			</div>
		</div>
	)
}

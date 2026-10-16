import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Pager } from "~/components/ui/pager"
import { paginate } from "~/lib/pagination"

const PAGE_SIZE = 10

export type StockTableRow = {
	serviceCodeId: string
	canonicalName: string
	onHand: number
	stockUnit: string | null
	countUnit: string | null
	derivedStockQty: number | null
	/** SAP / Claro code; empty when the catalog row is gone. */
	claroCode: string
	/** Most recent bulk movement at this warehouse (ISO time), or null. */
	lastMovement: { type: string; at: string } | null
}

/**
 * Per-SAP bulk stock rows: canonical name, dual-UOM (counted-as unit ·
 * derived stock-unit figure), and a per-row trail toggle. `derivedStockQty
 * === null` means the material has no conversion factor yet (spec §4.4) —
 * never fabricate a wrong-unit number, show "unit not set" instead.
 *
 * Search matches the row's already-resolved `canonicalName` (the lib layer
 * falls back to the raw catalog name when no canonical name is set, so this
 * also covers the un-settled "alternate name" rows). There is no kit/
 * composition table in the schema yet (spec §13 — the 21 duplicate-SAP-code
 * settlement is still an open Phase 0 item), so "kit/used-in" is a
 * name-substring proxy until that data lands.
 */
export function StockTable({
	rows,
	initialQuery = "",
	selectedCode,
	onSelectCode,
}: {
	rows: StockTableRow[]
	initialQuery?: string
	selectedCode: string | null
	onSelectCode: (serviceCodeId: string | null) => void
}) {
	const { t, i18n } = useTranslation()
	const [query, setQuery] = useState(initialQuery)
	const [kitOnly, setKitOnly] = useState(false)
	const [requestedPage, setRequestedPage] = useState(1)

	const term = query.trim().toLowerCase()
	const visible = rows.filter((r) => {
		const matchesQuery =
			term.length === 0 ||
			r.canonicalName.toLowerCase().includes(term) ||
			r.claroCode.toLowerCase().includes(term)
		const matchesKit = !kitOnly || /kit|used[\s-]?in/i.test(r.canonicalName)
		return matchesQuery && matchesKit
	})

	const { page, pageCount } = paginate(requestedPage, visible.length, PAGE_SIZE)
	const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

	return (
		<div className="space-y-2">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input
					type="search"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value)
						setRequestedPage(1)
					}}
					placeholder={t("stock.search_placeholder")}
					aria-label={t("stock.search_label")}
					className="flex-1"
				/>
				<label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
					<input
						type="checkbox"
						checked={kitOnly}
						onChange={(e) => {
							setKitOnly(e.target.checked)
							setRequestedPage(1)
						}}
					/>
					{t("stock.kit_filter_label")}
				</label>
			</div>
			{visible.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("stock.empty")}</p>
			) : (
				<Card>
					<CardContent className="space-y-1 p-3">
						{pageRows.map((r) => (
							<div
								key={r.serviceCodeId}
								data-testid={`stock-row-${r.serviceCodeId}`}
								className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
							>
								<span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
									{r.claroCode || "—"}
								</span>
								<span className="flex-1 basis-40">{r.canonicalName}</span>
								<span
									className="basis-36 text-xs text-muted-foreground"
									data-testid={`stock-last-${r.serviceCodeId}`}
								>
									{r.lastMovement
										? `${t(`stock.movement_type.${r.lastMovement.type}`, { defaultValue: r.lastMovement.type })} · ${new Date(r.lastMovement.at).toLocaleDateString(i18n.language)}`
										: t("stock.no_movement")}
								</span>
								<span className="flex items-center justify-end gap-1.5 text-right font-mono font-semibold">
									{r.onHand} {r.countUnit ?? ""}
									{r.onHand <= 0 && (
										<Badge variant="danger">{t("stock.out_tag")}</Badge>
									)}
								</span>
								<span className="flex items-center justify-end gap-1.5 text-right font-mono">
									{r.derivedStockQty === null ? (
										<>
											<span>—</span>
											<Badge variant="neutral">{t("stock.unit_not_set")}</Badge>
										</>
									) : (
										<span>
											= {r.derivedStockQty} {r.stockUnit}
										</span>
									)}
								</span>
								<Button
									type="button"
									variant="outline"
									size="xs"
									onClick={() =>
										onSelectCode(
											selectedCode === r.serviceCodeId ? null : r.serviceCodeId,
										)
									}
								>
									{selectedCode === r.serviceCodeId
										? t("stock.hide_trail")
										: t("stock.view_trail")}
								</Button>
							</div>
						))}
					</CardContent>
				</Card>
			)}
			<Pager
				page={page}
				pageCount={pageCount}
				total={visible.length}
				pageSize={PAGE_SIZE}
				onPageChange={setRequestedPage}
			/>
		</div>
	)
}

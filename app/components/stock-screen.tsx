import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AdjustPanel, type MaterialCode } from "~/components/adjust-panel"
import { MovementTrail } from "~/components/movement-trail"
import { ReceivePanel } from "~/components/receive-panel"
import {
	SnapshotPanel,
	type SnapshotRowData,
} from "~/components/snapshot-panel"
import { StockTable, type StockTableRow } from "~/components/stock-table"

export type StockScreenData = {
	selectedId: string | undefined
	bulk: StockTableRow[]
	query: string
	isLead: boolean
	materialCodes: MaterialCode[]
	snapshots: SnapshotRowData[]
}

/**
 * The `/warehouse/stock` screen's body, pulled out of the route file so it
 * can be rendered (and browser-tested) without importing the route's
 * server-only `loader` — a route file mixes both in one module, and a
 * `.server.ts` import breaks under vitest's browser project (no Node
 * built-ins). The route's default export is a thin `{loaderData}` wrapper
 * around this component.
 */
export function StockScreen({
	selectedId,
	bulk,
	query,
	isLead,
	materialCodes,
	snapshots,
	showTitle = true,
}: StockScreenData & {
	/** The route renders the title above the step rail; standalone use keeps it. */
	showTitle?: boolean
}) {
	const { t } = useTranslation()
	const [selectedCode, setSelectedCode] = useState<string | null>(null)

	if (!selectedId) {
		return (
			<div>
				{showTitle && (
					<h1 className="text-lg font-semibold text-foreground">
						{t("stock.title")}
					</h1>
				)}
				<p className="text-sm text-muted-foreground">
					{t("stock.no_warehouse")}
				</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{showTitle && (
				<h1 className="text-lg font-semibold text-foreground">
					{t("stock.title")}
				</h1>
			)}

			<section className="space-y-2">
				<StockTable
					rows={bulk}
					initialQuery={query}
					selectedCode={selectedCode}
					onSelectCode={setSelectedCode}
				/>
				{selectedCode && (
					<MovementTrail
						warehouseId={selectedId}
						serviceCodeId={selectedCode}
						unit={bulk.find((b) => b.serviceCodeId === selectedCode)?.countUnit}
						material={(() => {
							const row = bulk.find((b) => b.serviceCodeId === selectedCode)
							return row ? `${row.claroCode} ${row.canonicalName}`.trim() : null
						})()}
						onClose={() => setSelectedCode(null)}
					/>
				)}
			</section>

			<ReceivePanel warehouseId={selectedId} materialCodes={materialCodes} />
			{isLead && (
				<AdjustPanel warehouseId={selectedId} materialCodes={materialCodes} />
			)}
			{isLead && (
				<SnapshotPanel warehouseId={selectedId} snapshots={snapshots} />
			)}
		</div>
	)
}

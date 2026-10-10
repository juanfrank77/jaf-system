import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AdjustPanel, type MaterialCode } from "~/components/adjust-panel"
import { MovementTrail } from "~/components/movement-trail"
import { ReceivePanel } from "~/components/receive-panel"
import {
	SerialRegister,
	type SerialStockRow,
} from "~/components/serial-register"
import {
	SnapshotPanel,
	type SnapshotRowData,
} from "~/components/snapshot-panel"
import { StockTable, type StockTableRow } from "~/components/stock-table"

export type StockScreenData = {
	selectedId: string | undefined
	bulk: StockTableRow[]
	serial: SerialStockRow[]
	query: string
	isLead: boolean
	materialCodes: MaterialCode[]
	serialCodeNames: Record<string, { claroCode: string; name: string }>
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
	serial,
	query,
	isLead,
	materialCodes,
	serialCodeNames,
	snapshots,
}: StockScreenData) {
	const { t } = useTranslation()
	const [selectedCode, setSelectedCode] = useState<string | null>(null)

	if (!selectedId) {
		return (
			<div className="mx-auto w-full max-w-3xl p-4">
				<h1 className="text-lg font-semibold text-foreground">
					{t("stock.title")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t("stock.no_warehouse")}
				</p>
			</div>
		)
	}

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 p-4">
			<h1 className="text-lg font-semibold text-foreground">
				{t("stock.title")}
			</h1>

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

			<section>
				<SerialRegister rows={serial} codeNames={serialCodeNames} />
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

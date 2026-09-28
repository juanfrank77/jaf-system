import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"

export type SerialStockRow = {
	serviceCodeId: string
	condition: "NEW" | "REFURBISHED"
	count: number
}

/**
 * Serial-register sub-view: `SerialLocation` in-warehouse counts grouped by
 * material and condition (NEW vs REFURBISHED). `codeNames` resolves the raw
 * `serviceCodeId` to a Claro code + display name — `getWarehouseSerialStock`
 * doesn't join that itself (it's keyed only by id), so the loader supplies it.
 */
export function SerialRegister({
	rows,
	codeNames,
}: {
	rows: SerialStockRow[]
	codeNames: Record<string, { claroCode: string; name: string }>
}) {
	const { t } = useTranslation()
	const byCode = new Map<string, { NEW: number; REFURBISHED: number }>()
	for (const r of rows) {
		const entry = byCode.get(r.serviceCodeId) ?? { NEW: 0, REFURBISHED: 0 }
		entry[r.condition] = r.count
		byCode.set(r.serviceCodeId, entry)
	}

	return (
		<div className="space-y-2">
			<h2 className="text-sm font-semibold text-foreground">
				{t("stock.serial_register.title")}
			</h2>
			{byCode.size === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("stock.serial_register.empty")}
				</p>
			) : (
				<Card>
					<CardContent className="space-y-1.5 p-3">
						{[...byCode.entries()].map(([serviceCodeId, counts]) => {
							const code = codeNames[serviceCodeId]
							return (
								<div
									key={serviceCodeId}
									className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
								>
									<span className="flex-1">
										{code ? `${code.claroCode} — ${code.name}` : serviceCodeId}
									</span>
									<span className="flex gap-2">
										<Badge variant="info">
											{t("stock.serial_register.condition.NEW")} {counts.NEW}
										</Badge>
										<Badge variant="neutral">
											{t("stock.serial_register.condition.REFURBISHED")}{" "}
											{counts.REFURBISHED}
										</Badge>
									</span>
								</div>
							)
						})}
					</CardContent>
				</Card>
			)}
		</div>
	)
}

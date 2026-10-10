import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"

type TrailRow = {
	id: string
	type: string
	qty: number
	at: string
	actor: string
	note: string | null
	job: string | null
}

/**
 * Per-code movement trail (actor · time · job), fetched on demand from
 * `/api/warehouse-stock-trail` rather than embedded in the main loader — a
 * warehouse can carry hundreds of SAP rows and most never get expanded.
 */
export function MovementTrail({
	warehouseId,
	serviceCodeId,
	unit,
	material,
	onClose,
}: {
	warehouseId: string
	serviceCodeId: string
	/** Count unit of the material (qty is ledger/count-unit). */
	unit?: string | null
	/** "1003793 SPAN CLAMP": shown in the title so the trail names its material. */
	material?: string | null
	onClose: () => void
}) {
	const { t, i18n } = useTranslation()
	const fetcher = useFetcher<{ trail: TrailRow[] }>()

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable; re-run only when the code/warehouse pair changes
	useEffect(() => {
		fetcher.load(
			`/api/warehouse-stock-trail?warehouseId=${encodeURIComponent(warehouseId)}&serviceCodeId=${encodeURIComponent(serviceCodeId)}`,
		)
	}, [warehouseId, serviceCodeId])

	const rows = fetcher.data?.trail ?? []
	const loading = fetcher.state !== "idle" && !fetcher.data

	return (
		<Card data-testid="movement-trail">
			<CardContent className="space-y-2 p-3">
				<div className="flex items-center justify-between">
					<h3 className="text-xs font-semibold text-muted-foreground">
						{material
							? t("stock.trail.title_for", { material })
							: t("stock.trail.title")}
					</h3>
					<Button type="button" variant="ghost" size="xs" onClick={onClose}>
						{t("stock.hide_trail")}
					</Button>
				</div>
				{loading ? (
					<p className="text-xs text-muted-foreground">
						{t("stock.trail.loading")}
					</p>
				) : rows.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						{t("stock.trail.empty")}
					</p>
				) : (
					<ul className="space-y-1 text-xs">
						{rows.map((m) => (
							<li
								key={m.id}
								className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1 last:border-0"
							>
								<span className="font-medium">{m.actor}</span>
								<span className="text-muted-foreground">
									{new Date(m.at).toLocaleString(i18n.language)}
								</span>
								<span>
									{t(`stock.movement_type.${m.type}`, { defaultValue: m.type })}
								</span>
								<span className="font-mono">
									{m.qty > 0 ? `+${m.qty}` : m.qty}
									{unit ? ` ${unit}` : ""}
								</span>
								<span className="text-muted-foreground">
									{m.job ?? m.note ?? "—"}
								</span>
							</li>
						))}
					</ul>
				)}
				<p className="text-xs text-muted-foreground">{t("stock.trail.why")}</p>
			</CardContent>
		</Card>
	)
}

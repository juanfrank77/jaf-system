import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRevalidator } from "react-router"
import { CodeSearchSelect } from "~/components/code-search-select"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"

export type MaterialCode = {
	id: string
	claroCode: string
	name: string
	unit: string | null
	unitPrice: number
}

/**
 * Embeds Task 6's action: lead-gated, reason-required, idempotent. The real
 * authority check is server-side (requireWarehouseLead) — the parent only
 * hides this panel for non-leads as UX, not as the enforcement boundary.
 */
export function AdjustPanel({
	warehouseId,
	materialCodes,
}: {
	warehouseId: string
	materialCodes: MaterialCode[]
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{
		ok?: boolean
		errorKey?:
			| "adjust.reason_required"
			| "adjust.invalid_delta"
			| "adjust.invalid_service_code"
			| "adjust.idempotency_key_required"
		deduped?: boolean
	}>()
	const revalidator = useRevalidator()
	const [idempotencyKey, setIdempotencyKey] = useState(() =>
		crypto.randomUUID(),
	)
	const wasSubmitting = useRef(false)
	const [material, setMaterial] = useState<MaterialCode | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher/revalidator identity is stable; react to fetcher.state/data only
	useEffect(() => {
		if (fetcher.state === "submitting") wasSubmitting.current = true
		if (fetcher.state === "idle" && wasSubmitting.current) {
			wasSubmitting.current = false
			if (fetcher.data?.ok) {
				setIdempotencyKey(crypto.randomUUID())
				setMaterial(null)
				revalidator.revalidate()
			}
		}
	}, [fetcher.state, fetcher.data])

	return (
		<Card>
			<CardContent className="space-y-3 p-4">
				<h2 className="text-sm font-semibold">{t("stock.adjust.heading")}</h2>
				<fetcher.Form
					method="post"
					action="/warehouse/stock/adjust"
					key={idempotencyKey}
					className="flex flex-col gap-2 sm:flex-row sm:items-end"
				>
					<input type="hidden" name="warehouseId" value={warehouseId} />
					<input type="hidden" name="idempotencyKey" value={idempotencyKey} />
					<label className="flex-1 text-sm">
						<span className="mb-1 block text-muted-foreground">
							{t("stock.adjust.material_label")}
						</span>
						<input
							type="hidden"
							name="serviceCodeId"
							value={material?.id ?? ""}
						/>
						<CodeSearchSelect
							items={materialCodes}
							selected={material}
							placeholder={t("stock.adjust.material_placeholder")}
							label={t("stock.adjust.material_label")}
							onPick={setMaterial}
						/>
					</label>
					<label
						className="w-full text-sm sm:w-28"
						htmlFor="stock-adjust-delta"
					>
						<span className="mb-1 block text-muted-foreground">
							{t("stock.adjust.delta_label")}
						</span>
						<Input
							type="number"
							name="delta"
							id="stock-adjust-delta"
							required
						/>
					</label>
					<label className="flex-1 text-sm" htmlFor="stock-adjust-reason">
						<span className="mb-1 block text-muted-foreground">
							{t("stock.adjust.reason_label")}
						</span>
						<Input
							type="text"
							name="reason"
							id="stock-adjust-reason"
							required
						/>
					</label>
					<Button type="submit" disabled={!material}>
						{t("stock.adjust.submit")}
					</Button>
				</fetcher.Form>
				{fetcher.data?.errorKey && (
					<p className="text-xs text-status-danger">
						{t(fetcher.data.errorKey)}
					</p>
				)}
				{fetcher.data?.ok && (
					<p className="text-xs text-status-ok">{t("stock.adjust.success")}</p>
				)}
			</CardContent>
		</Card>
	)
}

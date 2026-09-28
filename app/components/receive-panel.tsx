import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRevalidator } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
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
 * Embeds Task 5's action, not its logic: one StockDelivery + RECEIVE
 * movements per line. Uses a fetcher (not a navigating Form) since the
 * target route has no component to render back into. On a successful
 * submit it revalidates the parent route's loader, so StockTable's
 * on-hand figures pick up the new movements without a full reload.
 */
export function ReceivePanel({
	warehouseId,
	materialCodes,
}: {
	warehouseId: string
	materialCodes: MaterialCode[]
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ ok?: boolean; errorKey?: string }>()
	const revalidator = useRevalidator()
	// Doubles as the form's reset key: rotating it on success remounts the
	// (cleared) line items AND mints a fresh idempotency key, so a double
	// submit of the SAME delivery is deduped server-side (runOnce) instead of
	// double-counting bulk on-hand.
	const [idempotencyKey, setIdempotencyKey] = useState(() =>
		crypto.randomUUID(),
	)
	const wasSubmitting = useRef(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher/revalidator identity is stable; react to fetcher.state/data only
	useEffect(() => {
		if (fetcher.state === "submitting") wasSubmitting.current = true
		if (fetcher.state === "idle" && wasSubmitting.current) {
			wasSubmitting.current = false
			if (fetcher.data?.ok) {
				setIdempotencyKey(crypto.randomUUID())
				revalidator.revalidate()
			}
		}
	}, [fetcher.state, fetcher.data])

	return (
		<Card>
			<CardContent className="space-y-3 p-4">
				<h2 className="text-sm font-semibold">{t("stock.receive.heading")}</h2>
				<fetcher.Form
					method="post"
					action="/warehouse/stock/receive"
					key={idempotencyKey}
					className="space-y-2"
				>
					<input type="hidden" name="warehouseId" value={warehouseId} />
					<input type="hidden" name="idempotencyKey" value={idempotencyKey} />
					<label className="block text-sm" htmlFor="stock-receive-reference">
						<span className="mb-1 block text-muted-foreground">
							{t("stock.receive.reference_label")}
						</span>
						<Input type="text" name="reference" id="stock-receive-reference" />
					</label>
					<MaterialLineItems serviceCodes={materialCodes} name="lines" />
					<Button type="submit">{t("stock.receive.submit")}</Button>
				</fetcher.Form>
				{fetcher.data?.errorKey && (
					<p className="text-xs text-status-danger">
						{t(fetcher.data.errorKey as never)}
					</p>
				)}
				{fetcher.data?.ok && (
					<p className="text-xs text-status-ok">{t("stock.receive.success")}</p>
				)}
			</CardContent>
		</Card>
	)
}

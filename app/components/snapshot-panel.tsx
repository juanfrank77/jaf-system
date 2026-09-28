import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRevalidator } from "react-router"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"

export type SnapshotRowData = {
	id: string
	warehouseId: string
	asOfDate: string | Date
	documentPath: string | null
	csvPath: string | null
}

function SnapshotRow({ snapshot }: { snapshot: SnapshotRowData }) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ ok: boolean }>()
	const revalidator = useRevalidator()
	const wasSubmitting = useRef(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher/revalidator identity is stable; react to fetcher.state/data only
	useEffect(() => {
		if (fetcher.state === "submitting") wasSubmitting.current = true
		if (fetcher.state === "idle" && wasSubmitting.current) {
			wasSubmitting.current = false
			if (fetcher.data?.ok) revalidator.revalidate()
		}
	}, [fetcher.state, fetcher.data])

	return (
		<div className="flex items-center justify-between gap-2 text-xs">
			<span>{new Date(snapshot.asOfDate).toLocaleDateString()}</span>
			{snapshot.documentPath && snapshot.csvPath ? (
				<span className="flex gap-3">
					<a
						className="text-primary underline"
						href={`/files/snapshots/${snapshot.id}.pdf`}
					>
						{t("stock.snapshot.download_pdf")}
					</a>
					<a
						className="text-primary underline"
						href={`/files/snapshots/${snapshot.id}.csv`}
					>
						{t("stock.snapshot.download_csv")}
					</a>
				</span>
			) : (
				<fetcher.Form method="post" action="/warehouse/stock/snapshot">
					<input type="hidden" name="intent" value="regenerate" />
					<input
						type="hidden"
						name="warehouseId"
						value={snapshot.warehouseId}
					/>
					<input type="hidden" name="snapshotId" value={snapshot.id} />
					<Button type="submit" variant="outline" size="xs">
						{t("stock.snapshot.regenerate")}
					</Button>
				</fetcher.Form>
			)}
		</div>
	)
}

/**
 * Embeds Task 7's action: row-first create (survives a PDF/CSV render
 * failure) + async artifact generation, with a per-row Regenerate fallback.
 */
export function SnapshotPanel({
	warehouseId,
	snapshots,
}: {
	warehouseId: string
	snapshots: SnapshotRowData[]
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ ok: boolean; snapshotId?: string }>()
	const revalidator = useRevalidator()
	const [resetToken, setResetToken] = useState(0)
	const wasSubmitting = useRef(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher/revalidator identity is stable; react to fetcher.state/data only
	useEffect(() => {
		if (fetcher.state === "submitting") wasSubmitting.current = true
		if (fetcher.state === "idle" && wasSubmitting.current) {
			wasSubmitting.current = false
			if (fetcher.data?.ok) {
				setResetToken((k) => k + 1)
				revalidator.revalidate()
			}
		}
	}, [fetcher.state, fetcher.data])

	return (
		<Card>
			<CardContent className="space-y-3 p-4">
				<h2 className="text-sm font-semibold">{t("stock.snapshot.heading")}</h2>
				<fetcher.Form
					method="post"
					action="/warehouse/stock/snapshot"
					key={resetToken}
					className="flex flex-wrap items-end gap-2"
				>
					<input type="hidden" name="warehouseId" value={warehouseId} />
					<input type="hidden" name="intent" value="create" />
					<label className="text-sm" htmlFor="stock-snapshot-as-of">
						<span className="mb-1 block text-muted-foreground">
							{t("stock.snapshot.as_of_label")}
						</span>
						<Input type="date" name="asOfDate" id="stock-snapshot-as-of" />
					</label>
					<Button type="submit">{t("stock.snapshot.submit")}</Button>
				</fetcher.Form>
				<div className="space-y-1.5">
					<h3 className="text-xs font-semibold text-muted-foreground">
						{t("stock.snapshot.recent_heading")}
					</h3>
					{snapshots.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("stock.snapshot.empty")}
						</p>
					) : (
						snapshots.map((s) => <SnapshotRow key={s.id} snapshot={s} />)
					)}
				</div>
			</CardContent>
		</Card>
	)
}

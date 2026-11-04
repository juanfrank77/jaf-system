import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import {
	ServiceSearch,
	type ServiceSearchResult,
} from "~/components/service-picker"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"

type Result = { ok?: true; errorKey?: ParseKeys } | undefined

/**
 * "Add service" under the Field step's service items: the new-order search
 * (code or description, no prices), then the installed quantity in the same
 * decimal box as the Actual column (0.5, 2.5 ft...). Posts `add_service` to
 * the Field route; the page reloads with the line in the table (Ordered 0,
 * "Added in field"). It sits inside the Field form: Enter adds, never saves.
 */
export function AddFieldService({ brigadeId }: { brigadeId?: string } = {}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<Result>()
	const [open, setOpen] = useState(false)
	const [picked, setPicked] = useState<ServiceSearchResult | null>(null)
	// Kept as typed: "2.5" must post 2.5, never 25.
	const [qty, setQty] = useState("1")
	const busy = fetcher.state !== "idle"
	const qtyNumber = Number(qty)
	const qtyValid =
		qty.trim() !== "" && Number.isFinite(qtyNumber) && qtyNumber > 0

	const reset = () => {
		setOpen(false)
		setPicked(null)
		setQty("1")
	}
	const add = () => {
		if (!picked || !qtyValid || busy) return
		fetcher.submit(
			{
				intent: "add_service",
				serviceCodeId: picked.id,
				qty: qty.trim(),
				...(brigadeId ? { brigadeId } : {}),
			},
			{ method: "post" },
		)
	}
	// Close once the server took it; a refusal stays open with its message.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on a finished post only
	useEffect(() => {
		if (fetcher.state === "idle" && fetcher.data?.ok) reset()
	}, [fetcher.state, fetcher.data])

	if (!open)
		return (
			<Button
				type="button"
				variant="outline"
				className="h-11 w-full sm:w-auto"
				onClick={() => setOpen(true)}
			>
				{t("docs_field.services.add")}
			</Button>
		)

	return (
		<div
			className="space-y-3 rounded-lg border bg-muted/30 p-3"
			data-testid="add-field-service"
		>
			<p className="text-xs text-muted-foreground">
				{t("docs_field.services.add_hint")}
			</p>
			{picked ? (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="text-sm font-medium leading-snug">{picked.name}</p>
						<p className="font-mono text-xs text-muted-foreground">
							{picked.claroCode}
							{picked.unit ? ` · ${picked.unit}` : ""}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							{t("docs_field.services.add_qty")}
						</span>
						<Input
							type="number"
							inputMode="decimal"
							step="any"
							min={0}
							className="w-24"
							aria-label={`${t("docs_field.services.add_qty")} ${picked.claroCode}`}
							value={qty}
							onChange={(e) => setQty(e.target.value)}
							onKeyDown={(e) => {
								// The box sits inside the Field form: Enter adds the
								// service instead of submitting (saving) the form.
								if (e.key !== "Enter") return
								e.preventDefault()
								add()
							}}
						/>
					</div>
				</div>
			) : (
				<ServiceSearch onPick={setPicked} showPrices={false} autoFocus />
			)}
			{!busy && fetcher.data?.errorKey && (
				<p role="alert" className="text-xs text-status-danger">
					{t(fetcher.data.errorKey)}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					type="button"
					className="h-11 flex-1"
					disabled={!picked || !qtyValid || busy}
					onClick={add}
				>
					{t("docs_field.services.add_confirm")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					className="h-11"
					disabled={busy}
					onClick={reset}
				>
					{t("docs_field.services.add_cancel")}
				</Button>
			</div>
		</div>
	)
}

/** The (x) on a line added in the field: posts `remove_added_service`. */
export function RemoveAddedService({
	serviceCodeId,
	claroCode,
	brigadeId,
}: {
	serviceCodeId: string
	claroCode: string
	brigadeId?: string
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<Result>()
	const busy = fetcher.state !== "idle"
	return (
		<>
			<button
				type="button"
				disabled={busy}
				onClick={() =>
					fetcher.submit(
						{
							intent: "remove_added_service",
							serviceCodeId,
							...(brigadeId ? { brigadeId } : {}),
						},
						{ method: "post" },
					)
				}
				className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger disabled:opacity-40"
				aria-label={t("docs_field.services.remove_added", { code: claroCode })}
			>
				<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
			</button>
			{!busy && fetcher.data?.errorKey && (
				<p role="alert" className="text-xs text-status-danger">
					{t(fetcher.data.errorKey)}
				</p>
			)}
		</>
	)
}

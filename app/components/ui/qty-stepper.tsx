import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"

const BUTTON =
	"flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted active:translate-y-px disabled:pointer-events-none disabled:opacity-40"

/** Thumb-sized quantity control for phones: `-` / number / `+`, each 44 px.
 * The number is typeable (footage is typed, pieces are tapped) and can be
 * cleared while typing; it settles back to the last valid value on blur. */
function QtyStepper({
	value,
	onChange,
	min = 0,
	max,
	label,
	invalid,
	className,
}: {
	value: number
	onChange: (value: number) => void
	min?: number
	max?: number
	/** Accessible name of the whole control, e.g. the line's service name. */
	label: string
	/** Amber highlight, e.g. the quantity differs from what was ordered. */
	invalid?: boolean
	className?: string
}) {
	const { t } = useTranslation()
	// While typing, show exactly what was typed (including empty).
	const [draft, setDraft] = useState<string | null>(null)
	const clamp = (n: number) =>
		Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n))

	return (
		<div
			data-slot="qty-stepper"
			className={cn("inline-flex items-center gap-1", className)}
		>
			<button
				type="button"
				aria-label={`${t("qty_stepper.decrease")}: ${label}`}
				className={BUTTON}
				disabled={value <= min}
				onClick={() => {
					setDraft(null)
					onChange(clamp(value - 1))
				}}
			>
				<HugeiconsIcon
					icon={MinusSignIcon}
					strokeWidth={2}
					className="size-5"
				/>
			</button>
			<input
				type="text"
				inputMode="numeric"
				pattern="[0-9]*"
				aria-label={label}
				value={draft ?? String(value)}
				onChange={(e) => {
					const raw = e.target.value.replace(/\D/g, "")
					setDraft(raw)
					if (raw !== "") onChange(clamp(Number.parseInt(raw, 10)))
				}}
				onFocus={(e) => e.target.select()}
				onBlur={() => setDraft(null)}
				className={cn(
					"h-11 w-16 rounded-lg border bg-background text-center text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					invalid ? "border-status-warn bg-status-warn-soft" : "border-input",
				)}
			/>
			<button
				type="button"
				aria-label={`${t("qty_stepper.increase")}: ${label}`}
				className={BUTTON}
				disabled={max !== undefined && value >= max}
				onClick={() => {
					setDraft(null)
					onChange(clamp(value + 1))
				}}
			>
				<HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-5" />
			</button>
		</div>
	)
}

export { QtyStepper }

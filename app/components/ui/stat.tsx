import { cn } from "~/lib/utils"

function Stat({
	label,
	value,
	detail,
	viz,
	icon,
	tone = "default",
	className,
}: {
	label: string
	value: string | number
	/** One short line under the value, e.g. "across 14 brigades". */
	detail?: React.ReactNode
	/** Small visual (ring, sparkline, bars) shown at the right edge. */
	viz?: React.ReactNode
	/** Optional leading icon chip shown beside the label. */
	icon?: React.ReactNode
	tone?: "default" | "danger"
	className?: string
}) {
	return (
		<div
			data-slot="stat"
			className={cn(
				"flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-3 shadow-xs",
				className,
			)}
		>
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					{icon}
					<div className="truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs">
						{label}
					</div>
				</div>
				<div
					className={cn(
						"mt-1 text-xl leading-tight font-semibold tracking-tight sm:text-2xl",
						tone === "danger" && "text-status-danger",
					)}
				>
					{value}
				</div>
				{detail && (
					<div className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-xs">
						{detail}
					</div>
				)}
			</div>
			{viz && <div className="shrink-0">{viz}</div>}
		</div>
	)
}

export { Stat }

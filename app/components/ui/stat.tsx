import { cn } from "~/lib/utils"

function Stat({
	label,
	value,
	className,
}: {
	label: string
	value: string | number
	className?: string
}) {
	return (
		<div
			data-slot="stat"
			className={cn(
				"rounded-xl border border-border bg-card p-4 shadow-card",
				className,
			)}
		>
			<div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</div>
			<div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
		</div>
	)
}

export { Stat }

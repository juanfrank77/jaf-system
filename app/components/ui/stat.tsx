import { cva, type VariantProps } from "class-variance-authority"
import { Link } from "react-router"
import { cn } from "~/lib/utils"

const statVariants = cva("block rounded-xl border p-4 shadow-card", {
	variants: {
		tone: {
			neutral: "border-border bg-card",
			ok: "border-status-ok/30 bg-status-ok-soft",
			info: "border-status-info/30 bg-status-info-soft",
			warn: "border-status-warn/30 bg-status-warn-soft",
			flag: "border-status-danger/30 bg-status-danger-soft",
		},
	},
	defaultVariants: { tone: "neutral" },
})

function Stat({
	label,
	value,
	sub,
	tone = "neutral",
	href,
	className,
}: {
	label: string
	value: string | number
	/** Small line under the value, e.g. "oldest 18 d". */
	sub?: string
	href?: string
	className?: string
} & VariantProps<typeof statVariants>) {
	const classes = cn(
		statVariants({ tone }),
		href && "transition-colors hover:border-primary/40",
		className,
	)
	const body = (
		<>
			<div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</div>
			<div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
			{sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
		</>
	)
	if (href) {
		return (
			<Link data-slot="stat" data-tone={tone} to={href} className={classes}>
				{body}
			</Link>
		)
	}
	return (
		<div data-slot="stat" data-tone={tone} className={classes}>
			{body}
		</div>
	)
}

export { Stat }

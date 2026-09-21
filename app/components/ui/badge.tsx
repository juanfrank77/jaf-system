import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold",
	{
		variants: {
			variant: {
				ok: "bg-status-ok-soft text-status-ok",
				warn: "bg-status-warn-soft text-status-warn",
				danger: "bg-status-danger-soft text-status-danger",
				info: "bg-status-info-soft text-status-info",
				neutral: "bg-muted text-muted-foreground",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
)

const dotVariants = {
	ok: "bg-status-ok",
	warn: "bg-status-warn",
	danger: "bg-status-danger",
	info: "bg-status-info",
	neutral: "bg-muted-foreground",
} as const

function Badge({
	className,
	variant,
	dot = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { dot?: boolean }) {
	return (
		<span
			data-slot="badge"
			data-variant={variant ?? "neutral"}
			className={cn(badgeVariants({ variant, className }))}
			{...props}
		>
			{dot && (
				<span
					aria-hidden="true"
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						dotVariants[variant ?? "neutral"],
					)}
				/>
			)}
			{props.children}
		</span>
	)
}

export { Badge, badgeVariants }

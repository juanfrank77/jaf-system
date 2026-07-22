import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
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

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			data-variant={variant ?? "neutral"}
			className={cn(badgeVariants({ variant, className }))}
			{...props}
		/>
	)
}

export { Badge, badgeVariants }

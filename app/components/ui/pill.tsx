import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const pillVariants = cva(
	"flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
	{
		variants: {
			variant: {
				info: "bg-status-info-soft text-foreground",
				warn: "bg-status-warn-soft text-foreground",
			},
		},
	},
)

function Pill({
	className,
	variant,
	icon,
	children,
}: {
	icon?: React.ReactNode
	children: React.ReactNode
} & VariantProps<typeof pillVariants> &
	Pick<React.ComponentProps<"div">, "className">) {
	return (
		<div data-slot="pill" className={cn(pillVariants({ variant, className }))}>
			{icon && <span className="text-lg leading-none">{icon}</span>}
			<div>{children}</div>
		</div>
	)
}

export { Pill }

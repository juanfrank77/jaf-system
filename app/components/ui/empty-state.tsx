import { cn } from "~/lib/utils"

function EmptyState({
	className,
	children,
}: {
	className?: string
	children: React.ReactNode
}) {
	return (
		<p
			data-slot="empty-state"
			className={cn("p-2 text-sm text-muted-foreground", className)}
		>
			{children}
		</p>
	)
}

export { EmptyState }

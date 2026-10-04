import { Badge } from "~/components/ui/badge"
import { EmptyState } from "~/components/ui/empty-state"
import { cn } from "~/lib/utils"

function QueueCard({
	title,
	count,
	variant,
	empty,
	className,
	children,
}: {
	title: React.ReactNode
	count: number
	variant: "ok" | "warn" | "danger" | "info"
	empty?: React.ReactNode
	className?: string
	children?: React.ReactNode
}) {
	return (
		<section
			data-slot="queue-card"
			className={cn(
				"space-y-2 rounded-xl border border-border bg-card p-3 shadow-card",
				className,
			)}
		>
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold">{title}</h2>
				<Badge variant={variant}>{count}</Badge>
			</div>
			{count === 0 ? empty ? <EmptyState>{empty}</EmptyState> : null : children}
		</section>
	)
}

export { QueueCard }

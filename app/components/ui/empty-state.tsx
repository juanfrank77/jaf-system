import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "~/lib/utils"

function EmptyState({
	icon,
	title,
	description,
	action,
	className,
	iconClassName,
}: {
	icon?: IconSvgElement
	title: React.ReactNode
	description?: React.ReactNode
	action?: React.ReactNode
	className?: string
	iconClassName?: string
}) {
	return (
		<div
			data-slot="empty-state"
			className={cn(
				"flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center",
				className,
			)}
		>
			{icon && (
				<span
					className={cn(
						"mb-1.5 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground",
						iconClassName,
					)}
				>
					<HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-5" />
				</span>
			)}
			<p className="text-sm font-semibold text-foreground">{title}</p>
			{description && (
				<p className="max-w-sm text-sm text-muted-foreground">{description}</p>
			)}
			{action && <div className="mt-3">{action}</div>}
		</div>
	)
}

export { EmptyState }

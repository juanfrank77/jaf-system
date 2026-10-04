import { cn } from "~/lib/utils"

function PageHeader({
	title,
	description,
	actions,
	className,
}: {
	title: React.ReactNode
	description?: React.ReactNode
	actions?: React.ReactNode
	className?: string
}) {
	return (
		<div
			data-slot="page-header"
			className={cn(
				"flex flex-wrap items-end justify-between gap-3",
				className,
			)}
		>
			<div>
				<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
				{description && (
					<p className="mt-1 text-sm text-muted-foreground">{description}</p>
				)}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	)
}

export { PageHeader }

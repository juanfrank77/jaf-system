import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "react-router"
import { cn } from "~/lib/utils"

function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
	return (
		<Link
			to={to}
			className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<HugeiconsIcon
				icon={ArrowLeft01Icon}
				strokeWidth={2}
				className="size-4"
			/>
			{children}
		</Link>
	)
}

function PageHeader({
	title,
	subtitle,
	meta,
	actions,
	back,
	className,
}: {
	title: React.ReactNode
	subtitle?: React.ReactNode
	meta?: React.ReactNode
	actions?: React.ReactNode
	back?: React.ReactNode
	className?: string
}) {
	return (
		<div
			data-slot="page-header"
			className={cn(
				"mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
				className,
			)}
		>
			<div className="min-w-0">
				{back && <div className="mb-2">{back}</div>}
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-2xl leading-8 font-semibold text-foreground">
						{title}
					</h1>
					{meta}
				</div>
				{subtitle && (
					<p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
				)}
			</div>
			{actions && (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			)}
		</div>
	)
}

export { BackLink, PageHeader }

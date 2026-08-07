import type { ReactNode } from "react"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"

type DashboardListCardProps<T> = {
	heading: ReactNode
	badgeVariant: "ok" | "warn" | "danger" | "info"
	items: T[]
	renderItem: (item: T) => ReactNode
}

export function DashboardListCard<T>({
	heading,
	badgeVariant,
	items,
	renderItem,
}: DashboardListCardProps<T>) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">{heading}</h2>
				<Badge variant={badgeVariant}>{items.length}</Badge>
			</div>
			{items.map(renderItem)}
		</div>
	)
}

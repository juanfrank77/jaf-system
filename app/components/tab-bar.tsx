import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import { cn } from "~/lib/utils"
import type { NavItem } from "./nav-model"

export function TabBar({
	items,
	"aria-label": ariaLabel,
}: {
	items: NavItem[]
	"aria-label": string
}) {
	const location = useLocation()
	const { t } = useTranslation()
	if (items.length === 0) return null
	return (
		<nav
			aria-label={ariaLabel}
			data-testid="tab-bar"
			className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
		>
			{items.map((item) => {
				const active =
					location.pathname === item.to ||
					(!item.exact &&
						item.to !== "/dashboard" &&
						location.pathname.startsWith(`${item.to}/`))
				return (
					<Link
						key={item.to}
						to={item.to}
						aria-current={active ? "page" : undefined}
						className={cn(
							"flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
							active ? "text-accent-text" : "text-muted-foreground",
						)}
					>
						<HugeiconsIcon
							icon={item.icon}
							strokeWidth={2}
							className="size-5"
						/>
						{t(item.labelKey)}
					</Link>
				)
			})}
		</nav>
	)
}

import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { buttonVariants } from "~/components/ui/button"
import { cn } from "~/lib/utils"

/**
 * "1–15 of 42" with Previous/Next. Server-paged lists pass `hrefFor` (the
 * buttons are links, so the loader re-runs); client-paged ones pass
 * `onPageChange`. Renders nothing when everything fits on one page.
 */
export function Pager({
	page,
	pageCount,
	total,
	pageSize,
	hrefFor,
	onPageChange,
}: {
	page: number
	pageCount: number
	total: number
	pageSize: number
	hrefFor?: (page: number) => string
	onPageChange?: (page: number) => void
}) {
	const { t } = useTranslation()
	if (pageCount <= 1) return null
	const from = (page - 1) * pageSize + 1
	const to = Math.min(page * pageSize, total)
	const cls = buttonVariants({ variant: "outline", size: "sm" })
	const control = (target: number, label: string, enabled: boolean) => {
		if (!enabled) {
			return (
				<span
					aria-disabled="true"
					className={cn(cls, "pointer-events-none opacity-50")}
				>
					{label}
				</span>
			)
		}
		return hrefFor ? (
			<Link to={hrefFor(target)} className={cls}>
				{label}
			</Link>
		) : (
			<button
				type="button"
				className={cls}
				onClick={() => onPageChange?.(target)}
			>
				{label}
			</button>
		)
	}
	return (
		<nav
			aria-label={t("pagination.nav")}
			className="flex items-center justify-between gap-3 text-sm"
		>
			<span className="text-muted-foreground">
				{t("pagination.range", { from, to, total })}
			</span>
			<span className="flex items-center gap-2">
				{control(page - 1, t("pagination.prev"), page > 1)}
				{control(page + 1, t("pagination.next"), page < pageCount)}
			</span>
		</nav>
	)
}

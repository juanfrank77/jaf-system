import type { NavCountVariant } from "~/lib/app-shell-nav"

export function CountBadge({
	count,
	variant,
}: {
	count: number
	variant: NavCountVariant
}) {
	if (count <= 0) return null
	return variant === "action" ? (
		<span className="jaf-pill">{count}</span>
	) : (
		<span className="jaf-n">{count}</span>
	)
}

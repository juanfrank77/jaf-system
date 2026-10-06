import { Pill } from "~/components/ui/pill"

/** A bold title and a body in a tinted pill: the "Step N · You" note under the
 * step rail. Composes `Pill`, so the markup matches the supervisor screens. */
function Callout({
	title,
	tone = "info",
	icon,
	className,
	children,
}: {
	title: string
	tone?: "info" | "warn"
	icon?: React.ReactNode
	className?: string
	children: React.ReactNode
}) {
	return (
		<Pill variant={tone} icon={icon} className={className}>
			<b>{title}</b> {children}
		</Pill>
	)
}

export { Callout }

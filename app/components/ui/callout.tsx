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
	/** `danger` is the red banner (e.g. a supervisor's sent-back
	 * note); `warn` for alerts; `ok` for completed handoffs;
	 * `info` for step/handoff notes. */
	tone?: "info" | "warn" | "danger" | "ok"
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

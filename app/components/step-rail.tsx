import { Link } from "react-router"
import { cn } from "~/lib/utils"

export type RailStep = {
	key: string
	/** Already translated. */
	label: string
	/** Reached steps link back to their read-only screen. Never applied to the
	 * current step or a locked one. */
	href?: string
	/** Not reachable yet for this role: greyed out, never a link. */
	locked?: boolean
	/** The step belongs to the viewer ("You"). */
	mine?: boolean
}

type RailState = "done" | "current" | "todo" | "locked"

export function StepRail({
	steps,
	current,
	ariaLabel,
	compact = false,
}: {
	steps: RailStep[]
	/** Index into `steps` of the step on screen. Out of range means no step is
	 * current. */
	current: number
	ariaLabel: string
	/** One equal-width row for a phone: labels truncate instead of wrapping. */
	compact?: boolean
}) {
	return (
		<ol
			aria-label={ariaLabel}
			data-compact={compact || undefined}
			className={cn(
				"flex gap-1 text-xs",
				compact ? "flex-nowrap" : "flex-wrap",
			)}
		>
			{steps.map((step, i) => {
				const state: RailState = step.locked
					? "locked"
					: i === current
						? "current"
						: i < current
							? "done"
							: "todo"
				const label = (
					<>
						{i + 1}. {step.label}
					</>
				)
				const linked = step.href && state !== "current" && state !== "locked"
				return (
					<li
						key={step.key}
						data-state={state}
						data-mine={step.mine || undefined}
						aria-current={state === "current" ? "step" : undefined}
						className={cn(
							"rounded-full border px-2 py-1",
							compact && "min-w-0 flex-1 truncate px-1 text-center text-[10px]",
							step.mine && "font-semibold",
							state === "done" &&
								"bg-status-ok-soft border-status-ok/30 text-status-ok",
							state === "current" &&
								"bg-primary border-primary text-primary-foreground font-medium",
							state === "todo" && "bg-card border-border text-muted-foreground",
							state === "locked" &&
								"bg-muted border-border text-muted-foreground/60",
						)}
					>
						{linked ? (
							<Link to={step.href as string} className="hover:underline">
								{label}
							</Link>
						) : (
							label
						)}
					</li>
				)
			})}
		</ol>
	)
}

import { useTranslation } from "react-i18next"
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
	touch = false,
	numbered = true,
	phoneSummary = false,
}: {
	steps: RailStep[]
	/** Index into `steps` of the step on screen. Out of range means no step is
	 * current. */
	current: number
	ariaLabel: string
	/** One equal-width row for a phone: labels truncate instead of wrapping. */
	compact?: boolean
	/** Every step is at least 44 px tall so a linked step is a thumb target. */
	touch?: boolean
	/** Prefix each label with its position. Off for a navigation rail where
	 * the numbers are clutter. */
	numbered?: boolean
	/** On a phone, replace the row of steps with "Step 3 of 9 · Field" and a
	 * progress bar. The full row stays from `md` up. */
	phoneSummary?: boolean
}) {
	const { t } = useTranslation()
	const position = Math.min(Math.max(current, 0), steps.length - 1)
	return (
		<>
			{phoneSummary && steps.length > 0 && (
				<div data-testid="step-summary" className="space-y-1.5 md:hidden">
					<p className="text-sm font-medium">
						{t("step_rail.progress", {
							current: position + 1,
							total: steps.length,
							label: steps[position].label,
						})}
					</p>
					<div
						role="progressbar"
						aria-valuemin={1}
						aria-valuemax={steps.length}
						aria-valuenow={position + 1}
						className="h-2 overflow-hidden rounded-full bg-muted"
					>
						<div
							className="h-full rounded-full bg-primary"
							style={{ width: `${((position + 1) / steps.length) * 100}%` }}
						/>
					</div>
				</div>
			)}
			<ol
				aria-label={ariaLabel}
				data-compact={compact || undefined}
				className={cn(
					"flex gap-1 text-xs",
					compact ? "flex-nowrap" : "flex-wrap",
					phoneSummary && "max-md:hidden",
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
							{numbered ? `${i + 1}. ` : ""}
							{step.label}
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
								touch && "flex min-h-11 items-center justify-center",
								touch && !compact && "px-3",
								compact &&
									"min-w-0 flex-1 truncate px-1 text-center text-[10px]",
								touch && compact && "text-[11px]",
								step.mine && "font-semibold",
								state === "done" &&
									"bg-status-ok-soft border-status-ok/30 text-status-ok",
								state === "current" &&
									"bg-primary border-primary text-primary-foreground font-medium",
								state === "todo" &&
									"bg-card border-border text-muted-foreground",
								state === "locked" &&
									"bg-muted border-border text-muted-foreground/60",
							)}
						>
							{linked ? (
								<Link
									to={step.href as string}
									className={cn(
										"hover:underline",
										touch && "flex min-h-11 w-full items-center justify-center",
									)}
								>
									{label}
								</Link>
							) : (
								label
							)}
						</li>
					)
				})}
			</ol>
		</>
	)
}

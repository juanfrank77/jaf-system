import type { ReactNode } from "react"

/**
 * The bottom bar of a step screen: back / cancel on the left, secondary
 * actions in the middle, the primary action on the right, with an optional
 * status line (what happens next, what is still missing) above them.
 */
export function StepActionBar({
	status,
	left,
	center,
	right,
}: {
	status?: ReactNode
	left?: ReactNode
	center?: ReactNode
	right: ReactNode
}) {
	return (
		<div
			data-testid="step-action-bar"
			className="sticky bottom-0 z-20 -mx-4 space-y-1.5 border-t border-border bg-background/95 px-4 py-2 backdrop-blur md:-mx-8 md:space-y-2 md:px-8 md:py-3"
		>
			{status}
			<div className="flex flex-wrap items-center gap-2">
				{left}
				{center}
				<div className="ml-auto">{right}</div>
			</div>
		</div>
	)
}

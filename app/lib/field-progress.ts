// Which boxes on the Field step still need filling, in page order. Actual
// quantities are highlighted and guide the cursor but never block Continue;
// the Field report and the Before / After photos do (the same rules the
// server checks on `continue`).

export type FieldTargetKind = "actual" | "tick" | "notes" | "before" | "after"

export type FieldTarget = {
	/** The DOM id to scroll to and focus. */
	id: string
	kind: FieldTargetKind
	empty: boolean
}

export function fieldTargets({
	actuals,
	ticks = [],
	notes,
	beforePhotos,
	afterPhotos,
}: {
	actuals: { id: string; value: string }[]
	/** Several crews: one box per service line no crew has ticked yet. */
	ticks?: { id: string }[]
	notes: string
	beforePhotos: number
	afterPhotos: number
}): FieldTarget[] {
	return [
		...actuals.map(
			(a): FieldTarget => ({
				id: a.id,
				kind: "actual",
				empty: a.value.trim() === "",
			}),
		),
		...ticks.map((t): FieldTarget => ({ id: t.id, kind: "tick", empty: true })),
		{ id: "fieldNotes", kind: "notes", empty: notes.trim() === "" },
		{ id: "photo-box-before", kind: "before", empty: beforePhotos === 0 },
		{ id: "photo-box-after", kind: "after", empty: afterPhotos === 0 },
	]
}

/** The first empty box after `afterId` (wrapping to the top when there is
 * none), or the first empty box overall when `afterId` is omitted. */
export function nextEmpty(
	targets: FieldTarget[],
	afterId?: string,
): FieldTarget | undefined {
	const from = afterId ? targets.findIndex((t) => t.id === afterId) + 1 : 0
	return (
		targets.slice(from).find((t) => t.empty) ?? targets.find((t) => t.empty)
	)
}

/** What still blocks Continue, in page order. */
export function blockingMissing(targets: FieldTarget[]): FieldTarget[] {
	return targets.filter((t) => t.empty && t.kind !== "actual")
}

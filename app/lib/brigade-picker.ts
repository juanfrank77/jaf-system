/**
 * The supervisor's brigade picker rules (S2), shared by the picker and the
 * server guard so the two can never disagree.
 *
 * - `own`: active, and the viewer supervises it, it sits in one of the
 *   viewer's admin-assigned areas, or nobody supervises it (unowned). Pickable
 *   as is: no activation, no event, its owner stays as it was.
 * - `inactive`: an inactive brigade nobody supervises (imported, or stood by
 *   back to the pool) or the viewer's own. Pickable as "Activate and assign":
 *   on save it becomes active under the viewer (`assignBrigades`).
 * - `with_other`: under ANOTHER supervisor: active and not in the viewer's
 *   areas, or inactive wherever it sits (area never frees another
 *   supervisor's inactive brigade). Any supervisor may add it to a job from
 *   the search ("usually with [name]"); the brigade stays with its owner, and
 *   only Admin moves brigades between supervisors.
 * - `hidden`: equipment ("D") accounts and terminated brigades. Never listed,
 *   never assignable by anyone.
 */
export type PickerState = "own" | "inactive" | "with_other" | "hidden"

export type PickerBrigade = {
	active: boolean
	supervisorId: string | null
	area: string | null
	isEquipmentAccount: boolean
	terminatedAt: Date | string | null
}

export function pickerState(
	b: PickerBrigade,
	viewer: { id: string; areas: string[] },
): PickerState {
	if (b.isEquipmentAccount || b.terminatedAt) return "hidden"
	const unownedOrMine = !b.supervisorId || b.supervisorId === viewer.id
	if (!b.active) return unownedOrMine ? "inactive" : "with_other"
	if (unownedOrMine) return "own"
	if (b.area && viewer.areas.includes(b.area)) return "own"
	return "with_other"
}

export type PickerViewer = { id: string; role: string; areas: string[] }

/**
 * Why `viewer` may not assign `b` to a job, or null when they may.
 * "invalid": hidden (equipment or terminated), for every role. Every other
 * brigade is assignable by anyone, another supervisor's included.
 */
export function assignRejection(
	b: PickerBrigade,
	_viewer: PickerViewer,
): "invalid" | null {
	if (b.isEquipmentAccount || b.terminatedAt) return "invalid"
	return null
}

/**
 * The rows a picker may offer `viewer`: every brigade except the hidden ones
 * (equipment, terminated). Inactive ones are included for supervisors only.
 */
export function pickableBrigades<T extends PickerBrigade>(
	rows: T[],
	viewer: PickerViewer,
): T[] {
	if (viewer.role !== "SUPERVISOR")
		return rows.filter((b) => b.active && pickerState(b, viewer) !== "hidden")
	return rows.filter((b) => pickerState(b, viewer) !== "hidden")
}

/**
 * The browser-safe picker rows: own, inactive and with_other (never hidden, so
 * equipment and terminated accounts do not reach the page). Non-supervisors
 * keep unscoped access, so every active brigade is `own` for them.
 */
export function toPickerBrigades<
	T extends PickerBrigade & {
		id: string
		name: string
		area: string | null
		code: string | null
		leadName: string | null
		supervisor?: { name: string } | null
	},
>(
	rows: T[],
	viewer: PickerViewer,
	lastWorked: ReadonlyMap<string, Date> = new Map(),
) {
	return rows.flatMap((b) => {
		const raw = pickerState(b, viewer)
		if (raw === "hidden") return []
		if (viewer.role !== "SUPERVISOR" && !b.active) return []
		const state = viewer.role === "SUPERVISOR" ? raw : "own"
		return [
			{
				id: b.id,
				name: b.name,
				area: b.area,
				code: b.code,
				leadName: b.leadName,
				state,
				active: b.active,
				supervisorName: b.supervisor?.name ?? null,
				lastWorkedAt: lastWorked.get(b.id)?.toISOString() ?? null,
			},
		]
	})
}

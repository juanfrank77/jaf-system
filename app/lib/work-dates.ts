/**
 * The "Trabajo efectuado entre" dates, taken from what the system already
 * logs: the work order's creation and its Field / Sign off. Nobody types
 * them, so a packet is never missing them.
 */
export function workDatesOf(doc: {
	createdAt: Date
	completedAt: Date | null
	fieldSubmittedAt: Date | null
}): { from: Date; to: Date } {
	const from = doc.createdAt
	const to = doc.completedAt ?? doc.fieldSubmittedAt ?? from
	return { from, to }
}

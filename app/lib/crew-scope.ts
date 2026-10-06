/**
 * A CREW user may only open or act on jobs they are currently assigned to
 * (`JafInvoice.assignedCrewIds`). Other roles are unaffected here; their
 * scoping lives in their own routes. Each route decides the response (404,
 * redirect, or the offline-sync 409), so this is a predicate rather than a
 * throwing guard.
 */
export function isUnassignedCrew(
	user: { id: string; role: string },
	doc: { assignedCrewIds: string[] },
): boolean {
	return user.role === "CREW" && !doc.assignedCrewIds.includes(user.id)
}

/** Body of the 404 an unassigned crew member gets. The status stays 404 and the
 * body carries no job data; the error boundary reads this marker to explain a
 * reassignment instead of showing a bare "Page Not Found". */
const NOT_ASSIGNED = "NOT_ASSIGNED"

export function notAssignedResponse(): Response {
	return new Response(NOT_ASSIGNED, { status: 404 })
}

/** True for the not-assigned 404 as the route error boundary receives it
 * (react-router exposes a thrown Response as `{ status, data }`). */
export function isNotAssignedError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false
	const e = error as { status?: unknown; data?: unknown }
	return e.status === 404 && e.data === NOT_ASSIGNED
}

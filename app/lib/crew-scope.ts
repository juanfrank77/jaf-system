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

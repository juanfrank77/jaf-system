/**
 * The job page's "next action" link: where this viewer goes to move the job
 * on, or null when the next move is not theirs. Field (status SIGNED) is the
 * supervisor's step now; crews never log in and the route refuses them.
 */
export function nextActionHref(
	doc: {
		id: string
		status: string
		assignedCrewIds?: string[] | null
		releasedToFinanceAt?: Date | string | null
	},
	userRole: string,
	userId: string,
): string | null {
	if (doc.status === "CREATED" && userRole === "WAREHOUSE")
		return `/docs/${doc.id}/prep`
	if (
		doc.status === "PREPPED" &&
		(userRole === "WAREHOUSE" ||
			userRole === "CREW" ||
			doc.assignedCrewIds?.includes(userId))
	)
		return `/docs/${doc.id}/sign`
	if (
		doc.status === "SIGNED" &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN")
	)
		return `/docs/${doc.id}/field`
	if (
		doc.status === "FIELD_UPDATED" &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN")
	)
		return `/docs/${doc.id}/review`
	if (
		(doc.status === "SUPERVISOR_APPROVED" || doc.status === "CLARO_UPLOADED") &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN") &&
		!doc.releasedToFinanceAt
	)
		return `/docs/${doc.id}/review`
	if (
		(doc.status === "SUPERVISOR_APPROVED" || doc.status === "CLARO_UPLOADED") &&
		(userRole === "FINANCE" || userRole === "ADMIN")
	)
		return `/finance/verify/${doc.id}`
	return null
}

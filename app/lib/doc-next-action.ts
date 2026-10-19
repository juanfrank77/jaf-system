/**
 * The job page's "next action" link: where this viewer goes to move the job
 * on, or null when the next move is not theirs. Field (status SIGNED) is the
 * supervisor's step now; crew accounts no longer sign in, so no step is theirs.
 */
export function nextActionHref(
	doc: {
		id: string
		status: string
		releasedToFinanceAt?: Date | string | null
	},
	userRole: string,
): string | null {
	if (doc.status === "CREATED" && userRole === "WAREHOUSE")
		return `/docs/${doc.id}/prep`
	if (doc.status === "PREPPED" && userRole === "WAREHOUSE")
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

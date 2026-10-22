import { isTerminalStatus } from "./permissions"

/**
 * "Fix a mistake" on a signed-off job. Before the packet goes to Claro the
 * supervisor reopens the job themselves (back to Field, signing off again
 * later). After that Claro, the Aviso or Finance hold copies of it, so a
 * supervisor can only ask an administrator, who reopens it. An administrator
 * has no such request to make.
 */
export function fixModeFor(
	doc: {
		status: string
		supervisorApprovedAt: Date | null
		jafInvoiceGeneratedAt: Date | null
		releasedToFinanceAt: Date | null
	},
	role: string,
): "reopen" | "request" | null {
	if (!doc.supervisorApprovedAt || isTerminalStatus(doc.status)) return null
	if (
		doc.status === "SUPERVISOR_APPROVED" &&
		!doc.jafInvoiceGeneratedAt &&
		!doc.releasedToFinanceAt
	)
		return "reopen"
	return role === "SUPERVISOR" ? "request" : null
}

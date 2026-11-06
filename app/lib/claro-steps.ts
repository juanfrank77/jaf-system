import type { ClaroPoStatus } from "../../generated/prisma/client"

export type ClaroStep = 1 | 2 | 3 | 4 | 5

export const CLARO_STEPS = [
	"load",
	"review",
	"generate",
	"submit",
	"close",
] as const
export type ClaroStepKey = (typeof CLARO_STEPS)[number]

/**
 * Which of the five Arm B steps a PO sits on, computed from its status and its
 * invoice. Pure and client-safe.
 * 1 Load (not read yet), 2 Review (read, not confirmed), 3 Generate (confirmed,
 * no invoice), 4 Submit (invoice made, not loaded to Ariba), 5 Close (loaded;
 * once paid the PO leaves the queue but still reads as 5).
 */
export function claroStepOf(po: {
	status: ClaroPoStatus
	invoice: { loadedAt: Date | null; paidAt: Date | null } | null
}): ClaroStep {
	if (po.status === "PENDING" || po.status === "READING") return 1
	if (po.status !== "CONFIRMED" && po.status !== "SUPERSEDED") return 2
	if (!po.invoice) return 3
	if (po.invoice.paidAt) return 5
	return po.invoice.loadedAt ? 5 : 4
}

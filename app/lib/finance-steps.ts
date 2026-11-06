// Finance's two arms. Arm A is JAF paying its people: a packet arrives in the
// Inbox and is accepted into the PBCC batch, the batch is sold to PBCC, and the
// sold Avisos go to Carmen as a payroll request that she pays. The bank's wire
// is not a step: payroll is paid on schedule regardless. Arm B is Claro paying
// JAF: its five steps live in claro-steps.ts. Every Arm A screen is exactly
// one step on this rail.
export type FinanceStep = "PACKETS" | "LC_REQUEST" | "LISTS"

export const FINANCE_STEPS: FinanceStep[] = ["PACKETS", "LC_REQUEST", "LISTS"]

/** One screen per step: no two steps share a URL. */
export const FINANCE_STEP_HREF: Record<FinanceStep, string> = {
	PACKETS: "/finance/queue",
	LC_REQUEST: "/finance/lc-requests",
	LISTS: "/finance/payroll",
}

export const FINANCE_STEP_LABEL_KEY = {
	PACKETS: "finance_flow.step.packets",
	LC_REQUEST: "finance_flow.step.lc_request",
	LISTS: "finance_flow.step.lists",
} as const

/** Which Arm A step a packet's request screen belongs to: sold, or still in the batch. */
export function pbccStep(job: {
	pbccRequestSentAt: Date | string | null
}): FinanceStep {
	return job.pbccRequestSentAt ? "LISTS" : "LC_REQUEST"
}

/**
 * Which Arm A list a released job is on, from its milestone timestamps.
 * Mirrors `stageWhere` in finance-stages.server.ts (the sold date is tested
 * first), which is what the sidebar counts and list screens filter on, so a
 * dashboard badge and the screen it points at cannot disagree.
 */
export function armAStepOf(job: {
	financeVerifiedAt: Date | string | null
	pbccRequestSentAt: Date | string | null
}): FinanceStep {
	if (job.pbccRequestSentAt) return "LISTS"
	return job.financeVerifiedAt ? "LC_REQUEST" : "PACKETS"
}

/** 1-based position of a step on the rail, derived from FINANCE_STEPS so it cannot drift. */
export function stepNumber(step: FinanceStep): number {
	return FINANCE_STEPS.indexOf(step) + 1
}

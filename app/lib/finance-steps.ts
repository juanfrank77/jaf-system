// Finance's two arms (Lissette's file, mockup v3), one rail each. Arm A is JAF
// paying its people: a packet arrives and is accepted, an LC request goes to
// the bank, the bank funds it, the funded packets become a Production Journal
// list for Carmen, and Carmen pays. Arm B is Claro paying JAF. Every Finance
// screen is exactly one step of one arm.
export type FinanceStep =
	| "PACKETS"
	| "LC_REQUEST"
	| "LC_FUNDED"
	| "LISTS"
	| "CARMEN"

export const FINANCE_STEPS: FinanceStep[] = [
	"PACKETS",
	"LC_REQUEST",
	"LC_FUNDED",
	"LISTS",
	"CARMEN",
]

/** One screen per step: no two steps share a URL. */
export const FINANCE_STEP_HREF: Record<FinanceStep, string> = {
	PACKETS: "/finance/queue",
	LC_REQUEST: "/finance/lc-requests",
	LC_FUNDED: "/finance/lc-funded",
	LISTS: "/finance/payroll",
	CARMEN: "/finance/awaiting-carmen",
}

export const FINANCE_STEP_LABEL_KEY = {
	PACKETS: "finance_flow.step.packets",
	LC_REQUEST: "finance_flow.step.lc_request",
	LC_FUNDED: "finance_flow.step.lc_funded",
	LISTS: "finance_flow.step.lists",
	CARMEN: "finance_flow.step.carmen",
} as const

export type ArmBStep = "AWAITING_PO" | "AWAITING_ARIBA" | "RECEIVABLES"

export const ARM_B_STEPS: ArmBStep[] = [
	"AWAITING_PO",
	"AWAITING_ARIBA",
	"RECEIVABLES",
]

export const ARM_B_STEP_HREF: Record<ArmBStep, string> = {
	AWAITING_PO: "/finance/awaiting-po",
	AWAITING_ARIBA: "/finance/awaiting-ariba",
	RECEIVABLES: "/finance/receivables",
}

/** Awaiting PO / Awaiting Ariba are placeholders until the Arm B phase. */
export const ARM_B_STEP_AVAILABLE: Record<ArmBStep, boolean> = {
	AWAITING_PO: false,
	AWAITING_ARIBA: false,
	RECEIVABLES: true,
}

export const ARM_B_STEP_LABEL_KEY = {
	AWAITING_PO: "finance_flow.arm_b.step.awaiting_po",
	AWAITING_ARIBA: "finance_flow.arm_b.step.awaiting_ariba",
	RECEIVABLES: "finance_flow.arm_b.step.receivables",
} as const

/** Which Arm A step a packet's request/funding screen belongs to. */
export function pbccStep(job: {
	pbccRequestSentAt: Date | string | null
	advanceReceivedAt: Date | string | null
}): FinanceStep {
	if (job.advanceReceivedAt) return "LISTS"
	if (job.pbccRequestSentAt) return "LC_FUNDED"
	return "LC_REQUEST"
}

// The finance department's loop (Lissette's file, mockup v3), in the
// order a job travels through it: a packet arrives and is verified and
// turned into a PBCC advance request, the brigade is paid through a
// fortnightly payroll run, Claro's PO is recorded against the Aviso,
// and the pipeline records what lands and closes the job. Every
// finance screen is exactly one step of this loop, so each renders a
// `FinanceStepRail` naming its step (mockup v3 priority 3: "Step rail
// + callout on every screen").
export type FinanceStep = "PACKETS" | "FUNDING" | "PAYROLL" | "PO" | "PIPELINE"

export const FINANCE_STEPS: FinanceStep[] = [
	"PACKETS",
	"FUNDING",
	"PAYROLL",
	"PO",
	"PIPELINE",
]

/** Route per step — the rail links a step back to its list screen. The
 * PO step has no list of its own: POs are recorded from the pipeline. */
export const FINANCE_STEP_HREF: Record<FinanceStep, string> = {
	PACKETS: "/finance/queue",
	FUNDING: "/finance/queue",
	PAYROLL: "/finance/payroll",
	PO: "/finance/receivables",
	PIPELINE: "/finance/receivables",
}

/** i18n key per step, inside the `finance_flow.step` namespace. */
export const FINANCE_STEP_LABEL_KEY = {
	PACKETS: "finance_flow.step.packets",
	FUNDING: "finance_flow.step.funding",
	PAYROLL: "finance_flow.step.payroll",
	PO: "finance_flow.step.po",
	PIPELINE: "finance_flow.step.pipeline",
} as const

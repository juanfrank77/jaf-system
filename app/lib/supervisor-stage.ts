import { isAvisoSaved } from "~/lib/aviso-document"
import type { JafInvoice } from "../../generated/prisma/client"

export type SupervisorStage =
	| "INTAKE"
	| "WAREHOUSE"
	| "FIELD"
	| "APPROVE"
	| "INVOICE"
	| "AVISO"
	| "PRECERT"
	| "RELEASE"
	| "RELEASED"

export const SUPERVISOR_STAGES: SupervisorStage[] = [
	"INTAKE",
	"WAREHOUSE",
	"FIELD",
	"APPROVE",
	"INVOICE",
	"AVISO",
	"PRECERT",
	"RELEASE",
	"RELEASED",
]

type StageDoc = Pick<
	JafInvoice,
	| "status"
	| "supervisorApprovedAt"
	| "jafInvoiceGeneratedAt"
	| "avisoNumber"
	| "avisoDocPath"
	| "releasedToFinanceAt"
>
type StageSheet = {
	sigSupervisorAt: Date | null
	sigSubcontractorAt: Date | null
} | null

export function deriveSupervisorStage(
	doc: StageDoc,
	sheet: StageSheet,
): SupervisorStage {
	if (doc.releasedToFinanceAt) return "RELEASED"
	if (isAvisoSaved(doc)) {
		return sheet?.sigSupervisorAt && sheet?.sigSubcontractorAt
			? "RELEASE"
			: "PRECERT"
	}
	if (doc.jafInvoiceGeneratedAt) return "AVISO"
	if (doc.supervisorApprovedAt) return "INVOICE"
	switch (doc.status) {
		case "CREATED":
			return "INTAKE"
		case "PREPPED":
			return "WAREHOUSE"
		case "SIGNED":
			return "FIELD"
		case "FIELD_UPDATED":
			return "APPROVE"
		default:
			return "INVOICE"
	}
}

/** Who a job is waiting on at each step, for the supervisor's open-work-orders list. */
export type WaitingOn = "warehouse" | "crew" | "you" | "finance"
export const WAITING_ON: Record<SupervisorStage, WaitingOn> = {
	INTAKE: "warehouse",
	// Prepped: the brigade still has to pick the material up.
	WAREHOUSE: "crew",
	// Crews never log in: the supervisor fills Field from what they send.
	FIELD: "you",
	APPROVE: "you",
	INVOICE: "you",
	AVISO: "you",
	PRECERT: "you",
	RELEASE: "you",
	RELEASED: "finance",
}

/** The screen a supervisor is looking at, and whether it accepts actions. */
export type StepView = {
	view: SupervisorStage
	/** Only the current step (and the invoice until the Aviso is started) can
	 * be acted on; every earlier step is a read-only look back. */
	interactive: boolean
}

/**
 * Legacy: Aviso lines were saved (the pre-F2 line match). `save_aviso` no
 * longer writes lines, so this is true only for old rows; a number alone only
 * means one was typed at intake (the optional field on the new-job form).
 */
export function isAvisoStarted(doc: {
	avisoNumber: string | null
	avisoLines: unknown
}): boolean {
	return doc.avisoLines != null
}

const stageIndex = (s: SupervisorStage) => SUPERVISOR_STAGES.indexOf(s)

/**
 * Which step's screen to show. Defaults to the derived stage, except that a
 * generated invoice keeps its own screen ("Continue to Aviso") until an Aviso
 * number or lines are saved. `requested` (from `?step=`) may only point at a
 * supervisor step (APPROVE onward) that has already been reached.
 */
export function resolveStepView(
	stage: SupervisorStage,
	avisoStarted: boolean,
	requested: string | null,
): StepView {
	const fallback: SupervisorStage =
		stage === "AVISO" && !avisoStarted ? "INVOICE" : stage
	const asked = SUPERVISOR_STAGES.find((s) => s === requested)
	const reachable =
		asked !== undefined &&
		stageIndex(asked) >= stageIndex("APPROVE") &&
		stageIndex(asked) <= stageIndex(stage)
	// A requested view of the default screen is just the default.
	const view = reachable ? asked : fallback
	return {
		view,
		interactive: view === stage || (view === "INVOICE" && stage === "AVISO"),
	}
}

/** Which panel renders for a step: everything up to Approve shares the
 * Approve screen, and "In Finance" shows the release summary. */
export function panelForStep(
	view: SupervisorStage,
): "APPROVE" | "INVOICE" | "AVISO" | "PRECERT" | "RELEASE" {
	switch (view) {
		case "INVOICE":
		case "AVISO":
		case "PRECERT":
			return view
		case "RELEASE":
		case "RELEASED":
			return "RELEASE"
		default:
			return "APPROVE"
	}
}

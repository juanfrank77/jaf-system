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
		return sheet?.sigSupervisorAt ? "RELEASE" : "PRECERT"
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
	/** Only the current step (and step 5 while the job waits at step 6) can
	 * be acted on; every earlier step is a read-only look back. */
	interactive: boolean
}

/**
 * Legacy only: Aviso lines were saved by the pre-F2 line match. `save_aviso`
 * no longer writes lines, so this is false for every new job; an Aviso number
 * alone never counts (it may have been typed at intake, on the new-job form).
 */
export function isAvisoStarted(doc: {
	avisoNumber: string | null
	avisoLines: unknown
}): boolean {
	return doc.avisoLines != null
}

const stageIndex = (s: SupervisorStage) => SUPERVISOR_STAGES.indexOf(s)

/**
 * Any Pre-cert signature (supervisor, sub-contractor or Claro): the sheet is
 * then never regenerated silently, and Replace Aviso is locked.
 */
export function isPreCertSigned(
	sheet: {
		sigSupervisorAt: Date | null
		sigSubcontractorAt: Date | null
		sigClaroAt: Date | null
	} | null,
): boolean {
	return !!(
		sheet &&
		(sheet.sigSupervisorAt || sheet.sigSubcontractorAt || sheet.sigClaroAt)
	)
}

/**
 * Which step's screen to show. Defaults to the derived stage, except that a
 * job sent to Claro (stage AVISO) opens on step 5 ("Continue to Aviso"),
 * which stays interactive; only a legacy job whose Aviso lines were saved
 * (`isAvisoStarted`) opens on step 6. Once the Aviso is saved the stage moves
 * on. `requested` (from `?step=`) may only point at a supervisor step
 * (APPROVE onward) that has already been reached. From Pre-cert, the Aviso
 * screen stays interactive (for Replace Aviso) until the Pre-cert sheet has a
 * signature (`preCertSigned`); after that it is view-only.
 */
export function resolveStepView(
	stage: SupervisorStage,
	avisoStarted: boolean,
	requested: string | null,
	preCertSigned: boolean,
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
		interactive:
			view === stage ||
			(view === "INVOICE" && stage === "AVISO") ||
			(view === "AVISO" && stage === "PRECERT" && !preCertSigned),
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

/**
 * Where a supervisor's list row opens: the screen of the step the job is on,
 * so the rail there highlights that step. Intake and Warehouse are the
 * warehouse's steps and have no supervisor screen, so they open the job page.
 * The step is always named, so a job sent to Claro (stage AVISO) opens on
 * Step 6 rather than on Step 5's "Continue to Aviso".
 */
export function supervisorStepHref(docId: string, stage: SupervisorStage) {
	if (stage === "INTAKE" || stage === "WAREHOUSE") return `/docs/${docId}`
	if (stage === "FIELD") return `/docs/${docId}/field`
	return `/docs/${docId}/review?step=${stage}`
}

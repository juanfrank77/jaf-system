import { hasAvisoPdf } from "~/lib/aviso-document"
import type { JafInvoice } from "../../generated/prisma/client"
import {
	type AvisoLine,
	type InvoiceLine,
	round2,
	sumLines,
} from "./service-lines"

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
	| "avisoMatchedAt"
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
	if (doc.avisoMatchedAt) {
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
	WAREHOUSE: "crew",
	FIELD: "crew",
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
 * The Aviso step has started once the supervisor has saved Aviso lines.
 * `save_aviso` writes the number and lines together, so the number alone only
 * means one was typed at intake (the optional field on the new-job form) and
 * must not hide the "Generate JAF invoice" button.
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

type AvisoMatchResult = {
	amountOk: boolean
	difference: number
	invoiceTotal: number
	avisoTotal: number
	lineMismatches: {
		serviceCodeId: string
		claroCode: string
		installedQty: number
		chargedQty: number
	}[]
}

export function checkAvisoMatch(
	invoiceLines: InvoiceLine[],
	avisoLines: AvisoLine[],
	tolerance: number,
): AvisoMatchResult {
	const invoiceTotal = sumLines(invoiceLines)
	const avisoTotal = sumLines(avisoLines)
	const difference = round2(Math.abs(invoiceTotal - avisoTotal))
	const byId = new Map<
		string,
		{ claroCode: string; installedQty: number; chargedQty: number }
	>()
	for (const l of invoiceLines)
		byId.set(l.serviceCodeId, {
			claroCode: l.claroCode,
			installedQty: l.qty,
			chargedQty: 0,
		})
	for (const l of avisoLines) {
		const e = byId.get(l.serviceCodeId)
		if (e) e.chargedQty = l.qty
		else
			byId.set(l.serviceCodeId, {
				claroCode: l.claroCode,
				installedQty: 0,
				chargedQty: l.qty,
			})
	}
	const lineMismatches = [...byId.entries()]
		.filter(([, v]) => v.installedQty !== v.chargedQty)
		.map(([serviceCodeId, v]) => ({ serviceCodeId, ...v }))
	return {
		amountOk: difference <= tolerance,
		difference,
		invoiceTotal,
		avisoTotal,
		lineMismatches,
	}
}

type ReleaseConditionKey =
	| "approved"
	| "invoice"
	| "aviso"
	| "amount_match"
	| "photos"
	| "precert_signed"
	| "contractor_code"

type ReleaseGateDoc = Pick<
	JafInvoice,
	| "supervisorApprovedAt"
	| "jafInvoiceGeneratedAt"
	| "avisoNumber"
	| "avisoDocPath"
	| "avisoLines"
	| "avisoMatchedAt"
	| "contractorAccountCode"
>

export function evaluateReleaseGate(
	doc: ReleaseGateDoc,
	sheet: StageSheet,
	photos: { tag: "BEFORE" | "AFTER" | null }[],
): { ok: boolean; conditions: { key: ReleaseConditionKey; ok: boolean }[] } {
	const avisoLines = Array.isArray(doc.avisoLines) ? doc.avisoLines : []
	const conditions: { key: ReleaseConditionKey; ok: boolean }[] = [
		{ key: "approved", ok: !!doc.supervisorApprovedAt },
		{ key: "invoice", ok: !!doc.jafInvoiceGeneratedAt },
		{
			key: "aviso",
			ok:
				!!doc.avisoNumber?.trim() && hasAvisoPdf(doc) && avisoLines.length > 0,
		},
		{ key: "amount_match", ok: !!doc.avisoMatchedAt },
		{
			key: "photos",
			ok:
				photos.some((p) => p.tag === "BEFORE") &&
				photos.some((p) => p.tag === "AFTER"),
		},
		{
			key: "precert_signed",
			ok: !!sheet?.sigSupervisorAt && !!sheet?.sigSubcontractorAt,
		},
		{ key: "contractor_code", ok: !!doc.contractorAccountCode },
	]
	return { ok: conditions.every((c) => c.ok), conditions }
}

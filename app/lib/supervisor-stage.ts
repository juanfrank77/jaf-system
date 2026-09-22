import type { DocStatus, JafInvoice } from "../../generated/prisma/client"
import {
	type AvisoLine,
	type InvoiceLine,
	round2,
	sumLines,
} from "./service-lines"

/**
 * Guide `.jaf-flow` strip — steps 1–8 (labels from JAF Ops Design System Guide).
 *
 * **Convention (default — pending product-owner confirmation): "last status reached".**
 * A job's step is the highest milestone completed, not work-in-progress. To switch
 * conventions later, change only {@link GUIDE_STEP_FROM_STATUS} and
 * {@link GUIDE_STEP_FROM_TIMESTAMP}.
 *
 * | Step | Reached when |
 * |------|----------------|
 * | 1 | `CREATED` |
 * | 2 | `PREPPED` |
 * | 3 | `SIGNED` |
 * | 4 | `FIELD_UPDATED` |
 * | 5 | `SUPERVISOR_APPROVED` (also base for `CLARO_UPLOADED` / `LC_REQUEST_GENERATED`) |
 * | 6 | `jafInvoiceGeneratedAt` set |
 * | 7 | `avisoMatchedAt` set (pre-cert signing stays at 7) |
 * | 8 | `releasedToFinanceAt` set |
 *
 * `CANCELLED` → `null`. Post-approval statuses take their step from timestamps,
 * not from the enum value alone.
 *
 * **Use {@link deriveGuideStep} for the 8-step strip.** {@link deriveSupervisorStage}
 * returns 9 internal stages (splits step 7 into AVISO + PRECERT) for StepRail /
 * supervisor UI — do not change that mapping when fixing guide steps.
 */

/** DocStatus → guide step (steps 1–5). Pending product-owner confirmation. */
export const GUIDE_STEP_FROM_STATUS: Partial<Record<DocStatus, number>> = {
	CREATED: 1,
	PREPPED: 2,
	SIGNED: 3,
	FIELD_UPDATED: 4,
	SUPERVISOR_APPROVED: 5,
	CLARO_UPLOADED: 5,
	LC_REQUEST_GENERATED: 5,
}

/** Timestamp fields that advance guide steps 6–8 (checked in step order). */
export const GUIDE_STEP_FROM_TIMESTAMP = [
	{ field: "jafInvoiceGeneratedAt", step: 6 },
	{ field: "avisoMatchedAt", step: 7 },
	{ field: "releasedToFinanceAt", step: 8 },
] as const satisfies ReadonlyArray<{
	field: keyof Pick<
		JafInvoice,
		"jafInvoiceGeneratedAt" | "avisoMatchedAt" | "releasedToFinanceAt"
	>
	step: number
}>

type GuideStepJob = Pick<
	JafInvoice,
	"status" | "jafInvoiceGeneratedAt" | "avisoMatchedAt" | "releasedToFinanceAt"
>

/** Guide `.jaf-flow` current step (1–8), or `null` when cancelled. */
export function deriveGuideStep(job: GuideStepJob): number | null {
	if (job.status === "CANCELLED") return null

	const fromStatus = GUIDE_STEP_FROM_STATUS[job.status]
	if (fromStatus === undefined) return null

	let step = fromStatus
	for (const { field, step: milestone } of GUIDE_STEP_FROM_TIMESTAMP) {
		if (job[field]) step = Math.max(step, milestone)
	}
	return step
}

/**
 * Guide's 9-stage supervisor model (StepRail). Splits guide step 7 into AVISO +
 * PRECERT for the Aviso match → PreCert sign → Release sequence.
 *
 *   1 Created         = INTAKE          (CREATED)
 *   2 Warehouse prep  = WAREHOUSE       (PREPPED)
 *   3 Crew signs out  = (SIGNED — not a distinct SupervisorStage)
 *   4 Field work      = FIELD           (SIGNED)
 *   5 You review      = APPROVE         (FIELD_UPDATED)
 *   6 JAF invoice     = INVOICE         (supervisorApprovedAt, no invoice yet)
 *   7 Aviso matched   = AVISO | PRECERT (jafInvoiceGeneratedAt / avisoMatchedAt)
 *   8 To Finance      = RELEASE | RELEASED (ready to release / releasedToFinanceAt)
 */
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

/**
 * Collapse a {@link SupervisorStage} onto the guide's 1–8 strip.
 *
 * @deprecated Prefer {@link deriveGuideStep} with the full job. SupervisorStage
 * cannot represent guide step 3 (crew sign-out): `PREPPED` and `SIGNED` map to
 * WAREHOUSE and FIELD only. Mapping is unchanged so StepRail callers are unaffected.
 */
export function supervisorStageToGuideStep(stage: SupervisorStage): number {
	switch (stage) {
		case "INTAKE":
			return 1
		case "WAREHOUSE":
			return 2
		case "FIELD":
			return 4
		case "APPROVE":
			return 5
		case "INVOICE":
			return 6
		case "AVISO":
		case "PRECERT":
			return 7
		case "RELEASE":
		case "RELEASED":
			return 8
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
				!!doc.avisoNumber?.trim() &&
				!!doc.avisoDocPath &&
				avisoLines.length > 0,
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

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
 * **Convention (decided 22 Sep 2026): work IN PROGRESS** — the step number is what
 * the role is doing *now*, not the last milestone reached. See v5 supervisor mockup.
 *
 * Step 1 ("Created") applies only to the **unsaved** new work-order form. Saved jobs
 * in `CREATED` start at step 2 (warehouse prep pending).
 *
 * | Step | In progress when |
 * |------|------------------|
 * | 1 | Unsaved new WO form only (not computed here) |
 * | 2 | `CREATED` |
 * | 3 | `PREPPED` |
 * | 4 | `SIGNED` (including sent back to crew) |
 * | 5 | `FIELD_UPDATED` |
 * | 6 | `SUPERVISOR_APPROVED` without `jafInvoiceGeneratedAt` |
 * | 7 | Invoice generated, Aviso not matched |
 * | 8 | `avisoMatchedAt` set — pre-cert + release; `allDone` when released |
 *
 * `CANCELLED` → `null`. {@link deriveSupervisorStage} / StepRail stay on the 9-stage
 * model — do not change them when adjusting guide steps.
 */

/** In-progress mapping (v5 mockup). Step 1 is form-only; saved jobs start at 2. */
export const GUIDE_PROGRESS_BY_STATUS: Partial<
	Record<DocStatus, { current: number; allDone: boolean }>
> = {
	CREATED: { current: 2, allDone: false },
	PREPPED: { current: 3, allDone: false },
	SIGNED: { current: 4, allDone: false },
	FIELD_UPDATED: { current: 5, allDone: false },
}

type GuideProgressJob = Pick<
	JafInvoice,
	"status" | "jafInvoiceGeneratedAt" | "avisoMatchedAt" | "releasedToFinanceAt"
>

export type GuideProgress = { current: number; allDone: boolean }

/** Guide `.jaf-flow` work-in-progress step (1–8), or `null` when cancelled. */
export function deriveGuideProgress(
	job: GuideProgressJob,
): GuideProgress | null {
	if (job.status === "CANCELLED") return null

	if (job.releasedToFinanceAt) {
		return { current: 8, allDone: true }
	}

	const base = GUIDE_PROGRESS_BY_STATUS[job.status]
	if (base) return base

	if (
		job.status === "SUPERVISOR_APPROVED" ||
		job.status === "CLARO_UPLOADED" ||
		job.status === "LC_REQUEST_GENERATED"
	) {
		if (!job.jafInvoiceGeneratedAt) return { current: 6, allDone: false }
		if (!job.avisoMatchedAt) return { current: 7, allDone: false }
		return { current: 8, allDone: false }
	}

	return null
}

/** @deprecated Use {@link deriveGuideProgress}. Returns `.current` for compatibility. */
export function deriveGuideStep(job: GuideProgressJob): number | null {
	return deriveGuideProgress(job)?.current ?? null
}

/** @deprecated Last-reached convention removed; kept for doc/tests referencing the old shape. */
export const GUIDE_STEP_FROM_STATUS: Partial<Record<DocStatus, number>> = {
	CREATED: 2,
	PREPPED: 3,
	SIGNED: 4,
	FIELD_UPDATED: 5,
	SUPERVISOR_APPROVED: 6,
	CLARO_UPLOADED: 6,
	LC_REQUEST_GENERATED: 6,
}

/** @deprecated Last-reached convention removed. */
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
	| "returns_reconciled"

type ReleasePrerequisiteKey = "contractor_code"

type MaterialQtyLine = { serviceCodeId: string; qty: number }

type ReturnRecordedLine = {
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes?: string
}

export function expectedReturnQty(takenQty: number, usedQty: number): number {
	return Math.max(0, takenQty - usedQty)
}

/** True when every material line has taken − used = 0, or the job took no materials. */
export function nothingExpectedBack(
	materialsTaken: unknown,
	materialsUsed: unknown,
): boolean {
	const taken = Array.isArray(materialsTaken)
		? (materialsTaken as MaterialQtyLine[])
		: []
	if (taken.length === 0) return true
	const usedMap = Object.fromEntries(
		(Array.isArray(materialsUsed)
			? (materialsUsed as MaterialQtyLine[])
			: []
		).map((u) => [u.serviceCodeId, u.qty]),
	)
	return taken.every(
		(t) => expectedReturnQty(t.qty, usedMap[t.serviceCodeId] ?? 0) === 0,
	)
}

/**
 * Warehouse returns reconciled for release gate item 7.
 * Short lines require a per-line note (see `/docs/:id/returns`).
 */
export function isReturnsReconciled(
	materialsTaken: unknown,
	materialsUsed: unknown,
	materialsReturned: unknown,
): boolean {
	if (nothingExpectedBack(materialsTaken, materialsUsed)) return true
	if (materialsReturned == null) return false
	if (!Array.isArray(materialsReturned)) return false

	const taken = Array.isArray(materialsTaken)
		? (materialsTaken as MaterialQtyLine[])
		: []
	const usedMap = Object.fromEntries(
		(Array.isArray(materialsUsed)
			? (materialsUsed as MaterialQtyLine[])
			: []
		).map((u) => [u.serviceCodeId, u.qty]),
	)
	const returnedLines = materialsReturned as ReturnRecordedLine[]

	for (const t of taken) {
		const used = usedMap[t.serviceCodeId] ?? 0
		const expected = expectedReturnQty(t.qty, used)
		if (expected === 0) continue

		const line = returnedLines.find((r) => r.serviceCodeId === t.serviceCodeId)
		if (!line) return false

		const lineExpected = expectedReturnQty(line.takenQty ?? t.qty, used)
		if (line.returnedQty < lineExpected && !line.notes?.trim()) return false
	}

	return returnedLines.length > 0
}

type ReleaseGateDoc = Pick<
	JafInvoice,
	| "supervisorApprovedAt"
	| "jafInvoiceGeneratedAt"
	| "avisoNumber"
	| "avisoDocPath"
	| "avisoLines"
	| "avisoMatchedAt"
	| "contractorAccountCode"
	| "materialsTaken"
	| "materialsUsed"
	| "materialsReturned"
>

export type ReleaseGateResult = {
	/** All seven mockup gate items pass. */
	ok: boolean
	conditions: { key: ReleaseConditionKey; ok: boolean }[]
	/** Extra checks that block release but are not gate rows (contractor_code placement pending PO). */
	prerequisites: { key: ReleasePrerequisiteKey; ok: boolean }[]
	/** `ok` and every prerequisite — use for release mutations and buttons. */
	releaseOk: boolean
}

export function evaluateReleaseGate(
	doc: ReleaseGateDoc,
	sheet: StageSheet,
	photos: { tag: "BEFORE" | "AFTER" | null }[],
): ReleaseGateResult {
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
			key: "precert_signed",
			ok: !!sheet?.sigSupervisorAt && !!sheet?.sigSubcontractorAt,
		},
		{
			key: "photos",
			ok:
				photos.some((p) => p.tag === "BEFORE") &&
				photos.some((p) => p.tag === "AFTER"),
		},
		{
			key: "returns_reconciled",
			ok: isReturnsReconciled(
				doc.materialsTaken,
				doc.materialsUsed,
				doc.materialsReturned,
			),
		},
	]
	// contractor_code placement pending product-owner confirmation
	const prerequisites: { key: ReleasePrerequisiteKey; ok: boolean }[] = [
		{ key: "contractor_code", ok: !!doc.contractorAccountCode },
	]
	const ok = conditions.every((c) => c.ok)
	const releaseOk = ok && prerequisites.every((p) => p.ok)
	return { ok, conditions, prerequisites, releaseOk }
}

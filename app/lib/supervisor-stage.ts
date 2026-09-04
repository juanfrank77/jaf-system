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

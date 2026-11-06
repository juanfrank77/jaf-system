/**
 * What the Arm B detail screen (Review, Generate, Submit) shows of one PO, and
 * how its checks group into the rows Lissette reads. Pure and client-safe.
 */
import type { ClaroStep } from "~/lib/claro-steps"
import {
	HARD_STOPS,
	type PoCheck,
	type PoCheckCode,
	type PoLine,
} from "~/lib/po-reading"

export type ClaroPoInvoiceView = {
	id: string
	/** "M20-005". */
	number: string
	workMonth: string
	subtotal: number
	ivu4: number
	ivu115: number
	total: number
	hasFile: boolean
	/** ISO instants. */
	madeAt: string
	loadedAt: string | null
	dueDate: string | null
	paidAt: string | null
}

export type ClaroPoView = {
	id: string
	fileName: string
	status:
		| "PENDING"
		| "READING"
		| "READY"
		| "NEEDS_LOOK"
		| "BLOCKED"
		| "UNMATCHED"
		| "CONFIRMED"
		| "SUPERSEDED"
	poNumber: string | null
	/** ISO day. */
	poDate: string | null
	avisoNumber: string | null
	/** 8-digit numbers the reader found in the conditions box. */
	avisoCandidates: string[]
	termsDays: number | null
	statedPages: number | null
	filePages: number | null
	lines: PoLine[]
	subtotal: number | null
	ivu4: number | null
	ivu115: number | null
	total: number | null
	/** What the PO printed, when kept; shown beside an edited header. */
	printed: {
		subtotal: number | null
		ivu4: number | null
		ivu115: number | null
		total: number | null
	} | null
	checks: PoCheck[]
	readError: string | null
	/** This Aviso's money before IVU: what JAF billed, what is already PO'd. */
	billed: number | null
	alreadyPod: number
	/** Set once a complete copy (or the original) replaced this one. */
	supersededById: string | null
	/** For a duplicate: the copy already confirmed or invoiced (else the first). */
	original: { id: string; poNumber: string | null } | null
	invoice: ClaroPoInvoiceView | null
	/** Work month to prefill on Generate. */
	suggestedMonth: string | null
	/** Where the PO is on the five steps (`claroStepOf`). */
	step: ClaroStep
}

/** The fields of the Review form, by input name. */
export type ReviewField =
	| "poNumber"
	| "poDate"
	| "avisoNumber"
	| "termsDays"
	| "statedPages"
	| "lines"
	| "subtotal"
	| "ivu4"
	| "ivu115"
	| "total"

/** The field Lissette fixes when a check fails. */
export const CHECK_FIELDS: Record<PoCheckCode, ReviewField[]> = {
	lines_sum: ["lines", "subtotal"],
	totals: ["subtotal", "ivu4", "ivu115", "total"],
	ivu_line: ["lines"],
	po_number_format: ["poNumber"],
	duplicate: ["poNumber"],
	pages_missing: ["statedPages"],
	pages_unknown: ["statedPages"],
	po_date_missing: ["poDate"],
	terms_missing: ["termsDays"],
	over_billed: ["avisoNumber", "lines"],
	unreadable: [],
}

export type CheckRowKey =
	| "lines_sum"
	| "totals"
	| "pages"
	| "duplicate"
	| Exclude<
			PoCheckCode,
			"lines_sum" | "totals" | "ivu_line" | "pages_missing" | "pages_unknown"
	  >

/** The four checks always listed, in the mockup's order. */
const FIXED: { key: CheckRowKey; codes: PoCheckCode[] }[] = [
	{ key: "lines_sum", codes: ["lines_sum"] },
	{ key: "totals", codes: ["totals", "ivu_line"] },
	{ key: "pages", codes: ["pages_missing", "pages_unknown"] },
	{ key: "duplicate", codes: ["duplicate"] },
]

export type CheckRow = {
	key: CheckRowKey
	/** The checks failing in this row; empty means it passed. */
	failing: PoCheck[]
	/** Failing codes a reason can override, one reason each. */
	overridable: PoCheckCode[]
	/** A failing code here stops the PO outright. */
	hardStop: boolean
	fields: ReviewField[]
}

/** The fixed rows, then one row per other failing check. */
export function checkRows(checks: PoCheck[]): CheckRow[] {
	const row = (key: CheckRowKey, codes: PoCheckCode[]): CheckRow => {
		const failing = checks.filter((c) => codes.includes(c.code))
		const failCodes = [...new Set(failing.map((c) => c.code))]
		return {
			key,
			failing,
			overridable: failCodes.filter((c) => !HARD_STOPS.has(c)),
			hardStop: failCodes.some((c) => HARD_STOPS.has(c)),
			fields: [...new Set(failCodes.flatMap((c) => CHECK_FIELDS[c]))],
		}
	}
	const fixedCodes = new Set(FIXED.flatMap((f) => f.codes))
	const extra = [
		...new Set(checks.map((c) => c.code).filter((c) => !fixedCodes.has(c))),
	] as Exclude<CheckRowKey, "lines_sum" | "totals" | "pages" | "duplicate">[]
	return [
		...FIXED.map((f) => row(f.key, f.codes)),
		...extra.map((code) => row(code, [code])),
	]
}

/** Fields named by a failing check, to mark on the form. */
export function fieldsToFix(checks: PoCheck[]): Set<ReviewField> {
	return new Set(checks.flatMap((c) => CHECK_FIELDS[c.code]))
}

export const hasCheck = (checks: PoCheck[], code: PoCheckCode) =>
	checks.some((c) => c.code === code)

/** Only a duplicate stops it, so the copy can be discarded. */
export function onlyDuplicateStops(checks: PoCheck[]): boolean {
	const hard = checks.filter((c) => HARD_STOPS.has(c.code))
	return hard.length > 0 && hard.every((c) => c.code === "duplicate")
}

/** JAF's vendor number at Claro, as printed on every Claro PO. */
export const CLARO_VENDOR_NUMBER = "400000077"

export type ClaroDetailError =
	| "claro.errors.bad_number"
	| "claro.errors.bad_lines"
	| "claro.errors.bad_date"
	| "claro.errors.reason_required"
	| "claro.errors.hard_stop"
	| "claro.errors.not_discardable"
	| "claro.errors.same_file"
	| "claro.errors.total_mismatch"
	| "claro.errors.work_month_required"
	| "claro.errors.already_submitted"
	| "claro.errors.no_invoice"
	| "claro.errors.not_editable"
	| "po_inbox.errors.not_pdf"
	| "po_inbox.errors.no_files"
	| "po_inbox.errors.incomplete"
	| "po_inbox.errors.duplicate"
	| "po_inbox.errors.aviso_not_found"
	| "po_inbox.errors.already_confirmed"
	| "po_inbox.errors.unknown"
	| "claro_invoices.errors.no_signature"

/**
 * What the Arm B detail screen (Review, Generate, Submit) shows of one PO, and
 * how its checks group into the rows Lissette reads. Pure and client-safe.
 */
import type { ClaroStep } from "~/lib/claro-steps"
import {
	isOverridable,
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
	/** Not a stored check: the PO has no Aviso linked (Unmatched). */
	| "aviso"
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
	/** Red. Usually because of `failing`; the Aviso row fails on its own. */
	failed: boolean
	/** The stored checks failing in this row. */
	failing: PoCheck[]
	/** Failing codes a reason can override, one reason each. */
	overridable: PoCheckCode[]
	/** A failing code here takes no reason: a hard stop, or a value to enter. */
	hardStop: boolean
	fields: ReviewField[]
}

/** No Aviso is linked to a PO still under review: an invoice needs one. */
export const avisoMissing = (po: Pick<ClaroPoView, "status" | "avisoNumber">) =>
	po.status !== "CONFIRMED" && !po.avisoNumber

/**
 * The fixed rows, then one row per other failing check. With `avisoMissing`,
 * an Aviso row that fails and takes no reason (no reason makes an invoice
 * without an Aviso).
 */
export function checkRows(
	checks: PoCheck[],
	opts: { avisoMissing?: boolean } = {},
): CheckRow[] {
	const row = (key: CheckRowKey, codes: PoCheckCode[]): CheckRow => {
		const failing = checks.filter((c) => codes.includes(c.code))
		const failCodes = [...new Set(failing.map((c) => c.code))]
		// A code takes a reason only when every failure under it can.
		const takesReason = (code: PoCheckCode) =>
			failing.filter((c) => c.code === code).every(isOverridable)
		return {
			key,
			failed: failing.length > 0,
			failing,
			overridable: failCodes.filter(takesReason),
			hardStop: failCodes.some((c) => !takesReason(c)),
			fields: [...new Set(failCodes.flatMap((c) => CHECK_FIELDS[c]))],
		}
	}
	const fixedCodes = new Set(FIXED.flatMap((f) => f.codes))
	const extra = [
		...new Set(checks.map((c) => c.code).filter((c) => !fixedCodes.has(c))),
	] as Exclude<
		CheckRowKey,
		"lines_sum" | "totals" | "pages" | "duplicate" | "aviso"
	>[]
	const aviso: CheckRow[] = opts.avisoMissing
		? [
				{
					key: "aviso",
					failed: true,
					failing: [],
					overridable: [],
					hardStop: true,
					fields: ["avisoNumber"],
				},
			]
		: []
	return [
		...FIXED.map((f) => row(f.key, f.codes)),
		...aviso,
		...extra.map((code) => row(code, [code])),
	]
}

/** Fields named by a failing check, to mark on the form. */
export function fieldsToFix(checks: PoCheck[]): Set<ReviewField> {
	return new Set(checks.flatMap((c) => CHECK_FIELDS[c.code]))
}

export const hasCheck = (checks: PoCheck[], code: PoCheckCode) =>
	checks.some((c) => c.code === code)

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
	| "claro.errors.not_ready"
	| "claro.errors.aviso_missing"
	| "claro.errors.future_date"
	| "claro.errors.bad_po_number"
	| "claro.errors.needs_entry"
	| "po_inbox.errors.not_pdf"
	| "po_inbox.errors.no_files"
	| "po_inbox.errors.incomplete"
	| "po_inbox.errors.duplicate"
	| "po_inbox.errors.aviso_not_found"
	| "po_inbox.errors.already_confirmed"
	| "po_inbox.errors.unknown"
	| "claro_invoices.errors.no_signature"

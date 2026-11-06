import { defaultWorkMonth, invoiceNumber } from "~/lib/claro-invoice"
import { type ClaroPoView, hasCheck } from "~/lib/claro-po-view"
import { claroStepOf } from "~/lib/claro-steps"
import { db } from "~/lib/db.server"
import { findOriginal, type fixPo } from "~/lib/po-inbox.server"
import { loadPoDetail } from "~/lib/po-inbox-view.server"
import { cents, type PoCheckCode, type PoLine } from "~/lib/po-reading"

/** Everything the Review, Generate and Submit steps show of one PO. */
export async function loadClaroPo(id: string): Promise<ClaroPoView | null> {
	const [detail, r] = await Promise.all([
		loadPoDetail(id),
		db.claroPo.findUnique({
			where: { id },
			select: {
				status: true,
				fileHash: true,
				receivedAt: true,
				avisoCandidates: true,
				printed: true,
				supersededById: true,
				doc: { select: { fieldStartedAt: true } },
				invoice: true,
			},
		}),
	])
	if (!detail || !r) return null
	const p =
		r.printed && typeof r.printed === "object" && !Array.isArray(r.printed)
			? (r.printed as Record<string, unknown>)
			: null
	const n = (x: unknown) => (typeof x === "number" ? x : null)
	const inv = r.invoice
	return {
		...detail,
		status: r.status,
		avisoCandidates: r.avisoCandidates,
		supersededById: r.supersededById,
		printed: p
			? {
					subtotal: n(p.subtotal),
					ivu4: n(p.ivu4),
					ivu115: n(p.ivu115),
					total: n(p.total),
				}
			: null,
		original: hasCheck(detail.checks, "duplicate")
			? await findOriginal({
					id,
					poNumber: detail.poNumber,
					fileHash: r.fileHash,
					receivedAt: r.receivedAt,
				}).then((o) => (o ? { id: o.id, poNumber: o.poNumber } : null))
			: null,
		invoice: inv
			? {
					id: inv.id,
					number: invoiceNumber(inv),
					workMonth: inv.workMonth,
					subtotal: Number(inv.subtotal),
					ivu4: Number(inv.ivu4),
					ivu115: Number(inv.ivu115),
					total: Number(inv.total),
					hasFile: inv.filePath !== null,
					madeAt: inv.madeAt.toISOString(),
					loadedAt: inv.loadedAt?.toISOString() ?? null,
					dueDate: inv.dueDate?.toISOString() ?? null,
					paidAt: inv.paidAt?.toISOString() ?? null,
				}
			: null,
		step: claroStepOf({ status: r.status, invoice: inv }),
		suggestedMonth: defaultWorkMonth(
			r.doc?.fieldStartedAt ?? null,
			detail.poDate ? new Date(`${detail.poDate}T12:00:00Z`) : null,
		),
	}
}

type FixInput = Parameters<typeof fixPo>[2]
type FixParse =
	| { ok: true; fields: FixInput }
	| { ok: false; error: "bad_number" | "bad_lines" | "bad_po_number" }

const text = (form: FormData, k: string) => {
	const v = form.get(k)
	return typeof v === "string" ? v.trim() : undefined
}

/** The largest amount a PO field or line may carry. */
const MAX_AMOUNT = 1e9
const amountOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT
/** The only IVU rates Claro bills, the two `recomputeFromLines` splits. */
const IVU_RATES = [0.04, 0.115]
const INT_RANGE = { termsDays: [0, 365], statedPages: [1, 99] } as const

/**
 * The Review form, reduced to what changed against the PO as it stands. Every
 * field is posted on each save, so sending them all to `fixPo` would mark
 * untouched ones as typed by hand. The money header is what the PO printed
 * (a header edit states it), so it is compared against `printed`, falling
 * back to the stored value only where nothing printed was kept. Any invalid
 * field refuses the whole save.
 */
export function parseFixForm(form: FormData, po: ClaroPoView): FixParse {
	const fields: FixInput = {}
	const poNumber = text(form, "poNumber")
	if (poNumber !== undefined) {
		const digits = poNumber.replace(/\D/g, "")
		if (digits !== (po.poNumber ?? "")) {
			// A number typed without a digit would clear the PO number silently.
			if (digits === "") return { ok: false, error: "bad_po_number" }
			fields.poNumber = poNumber
		}
	}
	const poDate = text(form, "poDate")
	if (poDate !== undefined && poDate !== (po.poDate ?? "")) {
		if (poDate !== "" && !parseDay(poDate))
			return { ok: false, error: "bad_number" }
		fields.poDate = poDate
	}
	const aviso = text(form, "avisoNumber")
	if (aviso && aviso.replace(/\D/g, "") !== (po.avisoNumber ?? ""))
		fields.avisoNumber = aviso

	for (const k of ["termsDays", "statedPages"] as const) {
		const v = text(form, k)
		if (v === undefined || v === "") continue
		const n = Number(v)
		const [lo, hi] = INT_RANGE[k]
		if (!Number.isInteger(n) || n < lo || n > hi)
			return { ok: false, error: "bad_number" }
		if (n !== po[k]) fields[k] = n
	}
	for (const k of ["subtotal", "ivu4", "ivu115", "total"] as const) {
		const v = text(form, k)
		if (v === undefined || v === "") continue
		const n = Number(v)
		if (!amountOk(n)) return { ok: false, error: "bad_number" }
		const was = po.printed?.[k] ?? po[k]
		if (was === null || cents(n) !== cents(was)) fields[k] = n
	}

	const raw = text(form, "lines")
	if (raw !== undefined && raw !== "") {
		const lines = parseLines(
			raw,
			po.lines.map((l) => l.ivuRate),
		)
		if (!lines) return { ok: false, error: "bad_lines" }
		const same =
			lines.length === po.lines.length &&
			lines.every((l, i) => sameLine(l, po.lines[i]))
		if (!same) fields.lines = lines
	}
	return { ok: true, fields }
}

type LineInput = Omit<PoLine, "ivu">

/** 4% and 11.5%, or a rate the reader already put on this PO's lines (so a
 * PO read with an odd rate can still be saved; a new odd rate cannot). */
const rateOk = (rate: number, known: number[]) =>
	[...IVU_RATES, ...known].some((r) => Math.abs(r - rate) < 1e-9)

function parseLines(raw: string, knownRates: number[]): LineInput[] | null {
	let v: unknown
	try {
		v = JSON.parse(raw)
	} catch {
		return null
	}
	if (!Array.isArray(v) || v.length > 500) return null
	const out: LineInput[] = []
	for (const l of v) {
		if (!l || typeof l !== "object") return null
		const o = l as Record<string, unknown>
		const amount = o.amount
		const ivuRate = o.ivuRate
		if (typeof amount !== "number" || !amountOk(amount)) return null
		if (typeof ivuRate !== "number" || !rateOk(ivuRate, knownRates)) return null
		out.push({
			item: String(o.item ?? "").slice(0, 40),
			description: String(o.description ?? "").slice(0, 500),
			amount: cents(amount) / 100,
			ivuRate,
		})
	}
	return out
}

const sameLine = (a: LineInput, b: PoLine) =>
	a.item === b.item &&
	a.description === b.description &&
	cents(a.amount) === cents(b.amount) &&
	a.ivuRate === b.ivuRate

const OVERRIDE_CODES: PoCheckCode[] = [
	"lines_sum",
	"totals",
	"ivu_line",
	"po_number_format",
	"pages_unknown",
	"po_date_missing",
	"terms_missing",
	"over_billed",
	"unreadable",
]

/** One `override-<code>` reason per red check; blank ones are left out. The
 * hard stops (missing pages, duplicate) are never read: they cannot be
 * overridden. */
export function parseOverrides(form: FormData) {
	return OVERRIDE_CODES.flatMap((check) => {
		const reason = text(form, `override-${check}`)
		return reason ? [{ check, reason: reason.slice(0, 500) }] : []
	})
}

/** A real calendar day as YYYY-MM-DD, or null. */
export function parseDay(v: string | undefined): Date | null {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
	const d = new Date(`${v}T12:00:00Z`)
	return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v
		? null
		: d
}

/** Today on the Puerto Rico calendar, YYYY-MM-DD. */
export const todayInPr = (now = new Date()) =>
	now.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })

/** Later than tomorrow on the Puerto Rico calendar (a day of slack for time
 * zones). Days in the past are fine. */
export function afterTomorrow(day: Date, now = new Date()): boolean {
	const today = parseDay(todayInPr(now)) as Date
	return day.getTime() > today.getTime() + 86_400_000
}

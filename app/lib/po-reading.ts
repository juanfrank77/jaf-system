/**
 * What a Claro PO says, and the checks that decide whether Lissette can
 * confirm it with one click. Pure and client-safe: the reader that fills a
 * `PoRead` and the database live elsewhere.
 */

export type PoLine = {
	item: string
	description: string
	/** Pre-IVU amount of the line. */
	amount: number
	/** 0.04 or 0.115. */
	ivuRate: number
	ivu: number
}

/** Everything read off one PO. Any field the reader could not find is null. */
export type PoRead = {
	poNumber: string | null
	/** ISO calendar day, already converted from Claro's DD.MM.YYYY. */
	poDate: string | null
	/** "1 de 4" -> 4. */
	statedPages: number | null
	termsDays: number | null
	/** 8-digit numbers found in the conditions box, most likely first. */
	avisoCandidates: string[]
	lines: PoLine[]
	subtotal: number | null
	ivu4: number | null
	ivu115: number | null
	total: number | null
}

export type PoCheckCode =
	| "lines_sum"
	| "totals"
	| "ivu_line"
	| "po_number_format"
	| "duplicate"
	| "pages_missing"
	| "pages_unknown"
	| "po_date_missing"
	| "terms_missing"
	| "over_billed"
	| "unreadable"

export type PoCheck = {
	code: PoCheckCode
	severity: "blocked" | "needs_look"
	detail?: string
}

type PoStatusResult = "READY" | "NEEDS_LOOK" | "BLOCKED" | "UNMATCHED"

/** A money amount in whole cents, rounded half up. */
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100)
const same = (a: number, b: number) => cents(a) === cents(b)

/** Claro writes dates day-first: "04.09.2026" is Sep 4, 2026 (Rule 3). Null if it is not a real date. */
export function parseClaroDate(raw: string | null | undefined): string | null {
	const m = raw?.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
	if (!m) return null
	const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
	const d = new Date(Date.UTC(year, month - 1, day))
	if (
		d.getUTCFullYear() !== year ||
		d.getUTCMonth() !== month - 1 ||
		d.getUTCDate() !== day
	)
		return null
	return d.toISOString().slice(0, 10)
}

export function runPoChecks(
	read: PoRead,
	ctx: {
		/** Pages actually in the uploaded file. */
		filePages: number
		duplicate: boolean
		/** What JAF billed for the Aviso, before IVU; null when no Aviso. */
		billedPreIvu: number | null
		/** Pre-IVU total of the other confirmed POs on the Aviso. */
		alreadyPod: number
	},
): PoCheck[] {
	const out: PoCheck[] = []
	const add = (
		code: PoCheckCode,
		severity: PoCheck["severity"],
		detail?: string,
	) => out.push({ code, severity, detail })

	if (!read.poNumber) add("po_number_format", "needs_look", "missing")
	else if (!/^\d{10}$/.test(read.poNumber))
		add("po_number_format", "needs_look", read.poNumber)
	if (ctx.duplicate) add("duplicate", "blocked", read.poNumber ?? undefined)

	if (read.statedPages === null) add("pages_unknown", "needs_look")
	else if (read.statedPages !== ctx.filePages)
		add("pages_missing", "blocked", `${ctx.filePages} of ${read.statedPages}`)

	if (!read.poDate) add("po_date_missing", "needs_look")
	if (read.termsDays === null) add("terms_missing", "needs_look")

	const lineSum = read.lines.reduce((s, l) => s + l.amount, 0)
	if (read.subtotal === null || !same(lineSum, read.subtotal))
		add("lines_sum", "needs_look", `${lineSum.toFixed(2)} vs ${read.subtotal}`)

	const ivuTotal = (read.ivu4 ?? 0) + (read.ivu115 ?? 0)
	const lineIvu = read.lines.reduce((s, l) => s + l.ivu, 0)
	if (
		read.subtotal === null ||
		read.total === null ||
		!same(read.subtotal + ivuTotal, read.total) ||
		!same(lineIvu, ivuTotal)
	)
		add("totals", "needs_look")

	read.lines.forEach((l, i) => {
		const expected = cents(l.amount * l.ivuRate) / 100
		// Claro rounds from unrounded quantities, so its printed IVU can be a cent off.
		if (Math.abs(cents(expected) - cents(l.ivu)) > 1)
			add(
				"ivu_line",
				"needs_look",
				`line ${i + 1}: ${l.ivu.toFixed(2)} vs ${expected.toFixed(2)}`,
			)
	})

	if (
		ctx.billedPreIvu !== null &&
		read.subtotal !== null &&
		cents(ctx.alreadyPod + read.subtotal) > cents(ctx.billedPreIvu)
	)
		add(
			"over_billed",
			"needs_look",
			`${(ctx.alreadyPod + read.subtotal).toFixed(2)} vs ${ctx.billedPreIvu.toFixed(2)}`,
		)
	return out
}

/** Only these stop a PO for good; everything else Lissette can fix or override. */
export const HARD_STOPS: ReadonlySet<PoCheckCode> = new Set<PoCheckCode>([
	"pages_missing",
	"duplicate",
])

/**
 * A value no invoice can be made without is missing (the PO date, or the PO
 * number altogether). No reason stands in for it: it is entered.
 */
export function needsEntry(c: PoCheck): boolean {
	return (
		c.code === "po_date_missing" ||
		(c.code === "po_number_format" && c.detail === "missing")
	)
}

/** A reason can carry this failing check past Review. */
export function isOverridable(c: PoCheck): boolean {
	return !HARD_STOPS.has(c.code) && !needsEntry(c)
}

/** Subtotal, IVU split and total rebuilt from the lines, cent-exact. */
export function recomputeFromLines(lines: PoLine[]): {
	subtotal: number
	ivu4: number
	ivu115: number
	total: number
} {
	const sum = (pick: (l: PoLine) => number, rate?: number) =>
		cents(
			lines
				.filter((l) => rate === undefined || l.ivuRate === rate)
				.reduce((s, l) => s + pick(l), 0),
		) / 100
	const subtotal = sum((l) => l.amount)
	const ivu4 = sum((l) => l.ivu, 0.04)
	const ivu115 = sum((l) => l.ivu, 0.115)
	return {
		subtotal,
		ivu4,
		ivu115,
		total: cents(subtotal + ivu4 + ivu115) / 100,
	}
}

/** Blocked beats Unmatched beats Needs a look beats Ready. */
export function statusFromChecks(
	checks: PoCheck[],
	avisoFound: boolean,
): PoStatusResult {
	if (checks.some((c) => HARD_STOPS.has(c.code))) return "BLOCKED"
	if (!avisoFound) return "UNMATCHED"
	if (checks.length > 0) return "NEEDS_LOOK"
	return "READY"
}

const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v)
		? v
		: typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
			? Number(v)
			: null

/** Turn whatever the reader returned into a well-formed `PoRead`; never throws. */
export function coercePoRead(raw: unknown): PoRead {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<
		string,
		unknown
	>
	const digits = (v: unknown) =>
		typeof v === "string" || typeof v === "number"
			? String(v).replace(/\D/g, "")
			: ""
	const lines = Array.isArray(r.lines)
		? r.lines.flatMap((l): PoLine[] => {
				const o = (l ?? {}) as Record<string, unknown>
				const amount = num(o.amount)
				const rate = num(o.ivuRate)
				if (amount === null || rate === null) return []
				return [
					{
						item: String(o.item ?? ""),
						description: String(o.description ?? ""),
						amount,
						// Rates arrive as 4 / 11.5 or 0.04 / 0.115.
						ivuRate: rate > 1 ? rate / 100 : rate,
						ivu: num(o.ivu) ?? 0,
					},
				]
			})
		: []
	const poNumber = digits(r.poNumber)
	return {
		poNumber: poNumber || null,
		poDate:
			typeof r.poDate === "string"
				? /^\d{4}-\d{2}-\d{2}$/.test(r.poDate)
					? r.poDate
					: parseClaroDate(r.poDate)
				: null,
		statedPages: num(r.statedPages),
		termsDays: num(r.termsDays),
		avisoCandidates: Array.isArray(r.avisoCandidates)
			? [
					...new Set(
						r.avisoCandidates.map(digits).filter((d) => d.length === 8),
					),
				]
			: [],
		lines,
		subtotal: num(r.subtotal),
		ivu4: num(r.ivu4),
		ivu115: num(r.ivu115),
		total: num(r.total),
	}
}

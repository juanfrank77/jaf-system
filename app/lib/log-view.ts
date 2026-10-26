/**
 * The log's view: what Carmen sees, prints, downloads and sends. It lives in the
 * URL, and this one function applies it on the screen and on the server, so a
 * printed PDF can never differ from the table it was printed from.
 */

export type LogColumnType = "text" | "date" | "money" | "number"

export type LogColumn = {
	key: string
	/** Printed on the PDF and the Excel header. */
	label: string
	/** Shown on screen, translated. */
	labelKey: string
	type: LogColumnType
	/** Summed in the totals and group subtotals. */
	total?: boolean
}

/** `YYYY-MM-DD` for a date, a number for money, or text. A missing date is the string "MISSING". */
export type LogCell = string | number | null
export type LogRow = Record<string, LogCell> & { id: string }

export const MISSING = "MISSING"

export type LogGroupBy = "none" | "week" | "month"

export type LogView = {
	/** Which date column the range applies to. */
	dateBy: string
	from: string | null
	to: string | null
	q: string
	/** Equality filters on a column, e.g. installer or status. */
	filters: Record<string, string>
	sort: { key: string; dir: "asc" | "desc" } | null
	/** Visible columns; empty = all. */
	cols: string[]
	group: LogGroupBy
}

export type LogGroup = {
	label: string
	rows: LogRow[]
	totals: Record<string, number>
}

export type LogResult = {
	rows: LogRow[]
	groups: LogGroup[]
	totals: Record<string, number>
	columns: LogColumn[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isIso = (s: string | null | undefined): s is string =>
	typeof s === "string" && ISO.test(s)

/** The view named by a URL's query string; anything unknown is ignored. */
export function parseLogView(
	params: URLSearchParams,
	columns: LogColumn[],
	filterKeys: string[],
	defaults: { dateBy: string },
): LogView {
	const keys = new Set(columns.map((c) => c.key))
	const dateKeys = new Set(
		columns.filter((c) => c.type === "date").map((c) => c.key),
	)
	const dateBy = params.get("dateBy")
	const sortKey = params.get("sort")
	const group = params.get("group")
	const from = params.get("from")
	const to = params.get("to")
	const filters: Record<string, string> = {}
	for (const k of filterKeys) {
		const v = params.get(k)
		if (v) filters[k] = v
	}
	return {
		dateBy: dateBy && dateKeys.has(dateBy) ? dateBy : defaults.dateBy,
		from: isIso(from) ? from : null,
		to: isIso(to) ? to : null,
		q: (params.get("q") ?? "").trim(),
		filters,
		sort:
			sortKey && keys.has(sortKey)
				? { key: sortKey, dir: params.get("dir") === "desc" ? "desc" : "asc" }
				: null,
		cols: (params.get("cols") ?? "").split(",").filter((k) => keys.has(k)),
		group: group === "week" || group === "month" ? group : "none",
	}
}

/** The query string that reproduces a view (the inverse of `parseLogView`). */
export function logViewQuery(view: LogView): URLSearchParams {
	const q = new URLSearchParams()
	if (view.from) q.set("from", view.from)
	if (view.to) q.set("to", view.to)
	q.set("dateBy", view.dateBy)
	if (view.q) q.set("q", view.q)
	for (const [k, v] of Object.entries(view.filters)) q.set(k, v)
	if (view.sort) {
		q.set("sort", view.sort.key)
		q.set("dir", view.sort.dir)
	}
	if (view.cols.length > 0) q.set("cols", view.cols.join(","))
	if (view.group !== "none") q.set("group", view.group)
	return q
}

/** Monday of the week containing a `YYYY-MM-DD` day, as `YYYY-MM-DD`. */
export function weekStart(day: string): string {
	const d = new Date(`${day}T12:00:00Z`)
	const back = (d.getUTCDay() + 6) % 7
	d.setUTCDate(d.getUTCDate() - back)
	return d.toISOString().slice(0, 10)
}

const mmdd = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]

function groupLabel(day: string | null, by: LogGroupBy): string {
	if (!day) return "No date"
	if (by === "week") return `Week of ${mmdd(weekStart(day))}`
	return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
}

const asNumber = (v: LogCell) => (typeof v === "number" ? v : 0)
const cents = (n: number) => Math.round(n * 100) / 100

function sumOf(rows: LogRow[], columns: LogColumn[]) {
	const out: Record<string, number> = {}
	for (const c of columns)
		if (c.total)
			out[c.key] = cents(rows.reduce((s, r) => s + asNumber(r[c.key]), 0))
	return out
}

function compare(a: LogCell, b: LogCell, type: LogColumnType): number {
	// Blank and MISSING go last either way round.
	const blank = (v: LogCell) => v == null || v === MISSING
	if (blank(a) || blank(b)) return Number(blank(a)) - Number(blank(b))
	if (type === "money" || type === "number") return asNumber(a) - asNumber(b)
	return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export function applyLogView(
	all: LogRow[],
	columns: LogColumn[],
	view: LogView,
): LogResult {
	const q = view.q.toLowerCase()
	const textKeys = columns.filter((c) => c.type === "text").map((c) => c.key)
	let rows = all.filter((r) => {
		const day = r[view.dateBy]
		if (view.from || view.to) {
			if (typeof day !== "string" || !isIso(day)) return false
			if (view.from && day < view.from) return false
			if (view.to && day > view.to) return false
		}
		for (const [k, v] of Object.entries(view.filters))
			if (String(r[k] ?? "") !== v) return false
		if (
			q &&
			!textKeys.some((k) =>
				String(r[k] ?? "")
					.toLowerCase()
					.includes(q),
			)
		)
			return false
		return true
	})
	if (view.sort) {
		const { key, dir } = view.sort
		const type = columns.find((c) => c.key === key)?.type ?? "text"
		rows = [...rows].sort((a, b) => {
			const c = compare(a[key], b[key], type)
			// MISSING and blank stay last when descending too.
			const blank =
				a[key] == null ||
				a[key] === MISSING ||
				b[key] == null ||
				b[key] === MISSING
			return dir === "desc" && !blank ? -c : c
		})
	}
	const shown = view.cols.length
		? columns.filter((c) => view.cols.includes(c.key))
		: columns
	let groups: LogGroup[] = [{ label: "", rows, totals: sumOf(rows, columns) }]
	if (view.group !== "none") {
		const byLabel = new Map<string, LogRow[]>()
		for (const r of rows) {
			const day = r[view.dateBy]
			const label = groupLabel(
				typeof day === "string" && isIso(day) ? day : null,
				view.group,
			)
			byLabel.set(label, [...(byLabel.get(label) ?? []), r])
		}
		groups = [...byLabel.entries()].map(([label, rs]) => ({
			label,
			rows: rs,
			totals: sumOf(rs, columns),
		}))
	}
	return { rows, groups, totals: sumOf(rows, columns), columns: shown }
}

/**
 * Dates in a chain (installed → invoiced → sold → received → paid): one that is
 * blank while a later one is filled is MISSING; one not reached yet stays blank.
 */
export function chainDates(chain: (string | null)[]): (string | null)[] {
	const lastFilled = chain.reduce((acc, v, i) => (v ? i : acc), -1)
	return chain.map((v, i) => (v ? v : i < lastFilled ? MISSING : null))
}

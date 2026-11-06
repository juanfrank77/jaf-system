import { type PoLine, type PoRead, parseClaroDate } from "~/lib/po-reading"

/**
 * Turns the text OCR made of a Claro PO into a `PoRead`. OCR of these scans
 * misreads a digit here and there, so the same page is read in several ways
 * and every candidate gets a vote. Totals are then picked as the combination
 * that adds up, which means a misread digit shows up as a failed check
 * (Needs a look) instead of a wrong number slipping through.
 */

const money = (s: string) => Number(s.replace(/,/g, ""))
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const AMOUNT = String.raw`\$?\s*([\d,]*\d\.\d{2})`

type Votes<T> = Map<T, number>
const vote = <T>(m: Votes<T>, v: T | null | undefined) => {
	if (v !== null && v !== undefined) m.set(v, (m.get(v) ?? 0) + 1)
}
const ranked = <T>(m: Votes<T>): T[] =>
	[...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)

function matches(text: string, re: RegExp): RegExpMatchArray[] {
	return [
		...text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`)),
	]
}

/** The 4% / 11.5% split. Line rates are not printed, so work out which lines carry 4%. */
function splitIvu(
	lines: PoLine[],
	ivu: number,
): { ivu4: number; ivu115: number; lines: PoLine[] } {
	const sub = lines.map((l) => l.amount)
	const n = lines.length
	const total = lines.reduce((s, l) => s + l.amount, 0)
	if (n === 0 || total === 0) return { ivu4: 0, ivu115: ivu, lines }
	let best: number | null = null
	let found = false
	if (n <= 14) {
		// The closest split wins. Claro rounds each line's IVU from unrounded
		// quantities, so its printed IVU can be up to a cent a line off.
		let bestOff = n + 1
		for (let mask = 0; mask < 1 << n && bestOff > 0; mask++) {
			let tax = 0
			for (let i = 0; i < n; i++)
				tax += r2(sub[i] * (mask & (1 << i) ? 0.04 : 0.115))
			const off = Math.abs(Math.round((r2(tax) - ivu) * 100))
			if (off < bestOff) {
				bestOff = off
				best = mask
			}
		}
		found = best !== null
	}
	if (best === null) {
		// No split explains it: keep it all at the nearer rate; the IVU check flags it.
		const rate =
			Math.abs(ivu - total * 0.04) < Math.abs(ivu - total * 0.115)
				? 0.04
				: 0.115
		best = rate === 0.04 ? (1 << n) - 1 : 0
	}
	const mask = best
	const out = lines.map((l, i) => {
		const ivuRate = mask & (1 << i) ? 0.04 : 0.115
		return { ...l, ivuRate, ivu: r2(l.amount * ivuRate) }
	})
	if (found) {
		// The printed IVU is the PO's: the cents Claro's rounding moved go one a line, largest first.
		let off = Math.round((ivu - out.reduce((s, l) => s + l.ivu, 0)) * 100)
		const byAmount = [...out].sort((a, b) => b.amount - a.amount)
		for (const l of byAmount) {
			if (off === 0) break
			const step = Math.sign(off)
			l.ivu = r2(l.ivu + step / 100)
			off -= step
		}
	}
	return {
		ivu4: r2(
			out.filter((l) => l.ivuRate === 0.04).reduce((s, l) => s + l.ivu, 0),
		),
		ivu115: r2(
			out.filter((l) => l.ivuRate === 0.115).reduce((s, l) => s + l.ivu, 0),
		),
		lines: out,
	}
}

type RawLine = { item: string; amount: number }

/** Sub-rows that print a quantity and unit price: "10 34005457 ... 2 SRV 201.93 USD". */
function parseLines(text: string): RawLine[] {
	const out: RawLine[] = []
	const rows = text.split("\n")
	rows.forEach((row, i) => {
		const m = row.match(
			/^\s*(\d{1,3}0)\s+\d{5,9}\s+.*?\b(\d+(?:\.\d+)?)\s+[A-Z]{2,4}\s+([\d,]*\d\.\d{2})\s+USD\b/,
		)
		if (!m) return
		const qty = Number(m[2])
		const price = money(m[3])
		if (!(price > 0) || !(qty > 0)) return
		const computed = r2(qty * price)
		// The printed line total is on the next row; trust it only if it agrees.
		const next = rows[i + 1]?.match(/([\d,]*\d\.\d{2})\s*\d?\s*$/)
		const printed = next ? money(next[1]) : null
		out.push({
			item: m[1].padStart(5, "0"),
			amount:
				printed !== null && Math.abs(printed - computed) < 0.015
					? printed
					: computed,
		})
	})
	return out
}

/**
 * Item rows: every Claro item prints its own "Subtotal <amount>" at the right
 * of its row, after the quantity and price columns. Service POs have no
 * quantity x price sub-row, so this is the only place their amount is printed.
 * The PO's own Subtotal starts a row of its own, with nothing before it.
 */
function parseItemRows(text: string): RawLine[] {
	const out: RawLine[] = []
	for (const row of text.split("\n")) {
		const m = row.match(/^(.*?)\bSubtotal\s*\$?\s*([\d,]*\d\.\d{2})/)
		if (!m) continue
		const before = m[1]
		const item = before.match(/^\s*(\d{5})\b/)?.[1]
		if (!item && !/\d\.\d/.test(before)) continue
		out.push({
			item: item ?? String((out.length + 1) * 10).padStart(5, "0"),
			amount: money(m[2]),
		})
	}
	return out
}

export function parseOcrPasses(passes: string[]): PoRead {
	const po: Votes<string> = new Map()
	const date: Votes<string> = new Map()
	const pages: Votes<number> = new Map()
	const terms: Votes<number> = new Map()
	const aviso: Votes<string> = new Map()
	const sub: Votes<number> = new Map()
	const ivu: Votes<number> = new Map()
	const tot: Votes<number> = new Map()
	const lineSets: RawLine[][] = []

	for (const text of passes) {
		for (const m of matches(text, /\b4\s?5\s?\d{2}\s?\d{2}\s?\d{4}\b/))
			vote(po, m[0].replace(/\s/g, ""))
		// A date followed by a time is a note's timestamp, not the PO date.
		for (const m of matches(
			text,
			/\b(\d{2})[.,](\d{2})[.,](20\d{2})\b(?!\s+\d{1,2}[:.]\d{2}[:.]\d{2})/,
		))
			vote(date, parseClaroDate(`${m[1]}.${m[2]}.${m[3]}`))
		// "1 de/of 4", read by OCR as "1 defof 4" or "2 delof 4".
		for (const m of matches(text, /\b\d\s*de[\s/fl|]*(?:of)?\s*(\d{1,2})\b/i))
			vote(pages, Number(m[1]))
		for (const m of matches(text, /VENCIMIENTO\s+EN\s+(\d{2,3})/i))
			vote(terms, Number(m[1]))
		if (/\bK010\b/.test(text)) vote(terms, 60)
		for (const m of matches(text, /(?<![\d.])(\d{8})(?![\d.])/))
			vote(aviso, m[1])
		for (const m of matches(
			text,
			new RegExp(String.raw`Subtotal\s*${AMOUNT}`, "i"),
		))
			vote(sub, money(m[1]))
		for (const m of matches(
			text,
			new RegExp(String.raw`(?:Total\s*)?[iIl]?VU(?:\s*Tax)?\s*${AMOUNT}`),
		))
			vote(ivu, money(m[1]))
		for (const m of matches(
			text,
			new RegExp(String.raw`Total\s*(?:USD|Pedido)?\s*${AMOUNT}`, "i"),
		))
			vote(tot, money(m[1]))
		lineSets.push(parseLines(text), parseItemRows(text))
	}

	// Every way the lines were read, with how many passes read them that way.
	const lineKey = (ls: RawLine[]) =>
		ls.map((l) => `${l.item}:${l.amount}`).join("|")
	const byKey: Votes<string> = new Map()
	for (const ls of lineSets) if (ls.length > 0) vote(byKey, lineKey(ls))
	const sumOf = (ls: RawLine[]) => r2(ls.reduce((s, l) => s + l.amount, 0))
	const readings = ranked(byKey).map(
		(k) => lineSets.find((ls) => lineKey(ls) === k) as RawLine[],
	)
	const lineSums = new Set(readings.map(sumOf))

	// Pick the (subtotal, IVU, total) that adds up, preferring one the lines add to.
	const subs = ranked(sub)
	const ivus = ranked(ivu)
	const tots = ranked(tot)
	let pick: { s: number; i: number; t: number } | null = null
	let pickScore = -1
	for (const s of subs)
		for (const i of ivus)
			for (const t of tots) {
				if (Math.abs(r2(s + i) - t) > 0.005) continue
				const score =
					(sub.get(s) ?? 0) +
					(ivu.get(i) ?? 0) +
					(tot.get(t) ?? 0) +
					(lineSums.has(r2(s)) ? 10 : 0)
				if (score > pickScore) {
					pickScore = score
					pick = { s, i, t }
				}
			}
	// The lines that add up to the subtotal win; failing that, the most-read lines.
	const rawLines =
		readings.find((ls) => pick !== null && sumOf(ls) === r2(pick.s)) ??
		readings[0] ??
		[]
	const lineSum = sumOf(rawLines)
	const subtotal = pick?.s ?? subs[0] ?? (lineSum || null)
	const ivuTotal = pick?.i ?? ivus[0] ?? null
	const total = pick?.t ?? tots[0] ?? null

	const baseLines: PoLine[] = rawLines.map((l) => ({
		item: l.item,
		description: "",
		amount: l.amount,
		ivuRate: 0.115,
		ivu: 0,
	}))
	const split = splitIvu(baseLines, ivuTotal ?? 0)

	const avisoRanked = ranked(aviso).sort(
		(a, b) =>
			Number(b.startsWith("10")) - Number(a.startsWith("10")) ||
			(aviso.get(b) ?? 0) - (aviso.get(a) ?? 0),
	)
	return {
		poNumber: ranked(po)[0] ?? null,
		poDate: ranked(date)[0] ?? null,
		statedPages: ranked(pages)[0] ?? null,
		termsDays: ranked(terms)[0] ?? null,
		avisoCandidates: avisoRanked,
		lines: split.lines,
		subtotal,
		ivu4: ivuTotal === null ? null : split.ivu4,
		ivu115: ivuTotal === null ? null : split.ivu115,
		total,
	}
}

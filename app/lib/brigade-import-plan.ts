import type { BrigadeImportRow } from "./brigade-import"

export type ExistingBrigade = {
	id: string
	name: string
	code: string | null
}

export type BrigadeRecode = {
	brigadeId: string
	from: string | null
	to: string
	confidence: "code" | "name" | "close" | "manual"
}

export type BrigadeSuggestion = {
	brigadeId: string
	csvCode: string
	confidence: "close"
}

export type BrigadeImportPlan = {
	/** Existing brigades whose `code` changes. Only `code` is ever touched. */
	recodes: BrigadeRecode[]
	/** Near-name matches. Shown to the user, NEVER applied without an override. */
	suggestions: BrigadeSuggestion[]
	creates: BrigadeImportRow[]
	skipped: {
		code: string
		reason: "unchanged" | "claimed" | "duplicate_code_in_file"
	}[]
	/** Rows with a warning or a "check with Lissette" note; still imported. */
	flagged: BrigadeImportRow[]
	/** Overrides that could not be honoured; shown to the user, never applied. */
	ignoredOverrides: {
		brigadeId: string
		code: string
		reason:
			| "unknown_brigade"
			| "brigade_matched_by_code"
			| "code_not_in_file"
			| "code_claimed"
	}[]
}

const SUFFIXES = new Set(["LLC", "INC", "CORP"])
const WORDS: Record<string, string> = {
	COMM: "COMMUNICATION",
	COMMS: "COMMUNICATION",
	COMMUNICATIONS: "COMMUNICATION",
	CONST: "CONSTRUCTION",
	CONTRUCTION: "CONSTRUCTION",
}

/**
 * Uppercase, accents and punctuation stripped, COMM/COMMUNICATIONS ->
 * COMMUNICATION, CONST/CONTRUCTION -> CONSTRUCTION, LLC/INC/CORP and
 * single-letter initials ("SAMUEL A. GONZALEZ") dropped.
 */
export function normalizeBrigadeName(s: string): string {
	return tokens(s).join(" ")
}

function rawTokens(s: string): string[] {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toUpperCase()
		.replace(/&/g, " ")
		.replace(/[^A-Z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean)
		.map((w) => WORDS[w] ?? w)
		.filter((w) => !SUFFIXES.has(w))
}

function tokens(s: string): string[] {
	return rawTokens(s).filter((w) => w.length > 1)
}

function initials(s: string): string {
	return rawTokens(s)
		.filter((w) => w.length === 1)
		.join("")
}

/**
 * Exact-name equality for an automatic recode: same words (at least two, so a
 * bare first name never auto-matches), and the initials agree or at least one
 * side has none. "JUAN A VAZQUEZ" is not "JUAN M VAZQUEZ".
 */
function sameName(a: string, b: string): boolean {
	const ta = tokens(a)
	if (ta.length < 2 || ta.join(" ") !== tokens(b).join(" ")) return false
	const ia = initials(a)
	const ib = initials(b)
	return ia === "" || ib === "" || ia === ib
}

/** True when `a` and `b` differ by at most one substitution, insertion or deletion. */
function withinOneEdit(a: string, b: string): boolean {
	if (a === b) return true
	if (Math.abs(a.length - b.length) > 1) return false
	let i = 0
	while (i < a.length && i < b.length && a[i] === b[i]) i++
	if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
	const [long, short] = a.length > b.length ? [a, b] : [b, a]
	return long.slice(i + 1) === short.slice(i)
}

/**
 * Conservative "close" score in (0, 1], 0 when not close. Two ways to be close:
 *  - every token of the shorter name (at least 2 tokens) appears in the longer
 *    ("ALEXIS DIAZ" in "ALEXIS DIAZ SIERRA");
 *  - same token count and every token is equal, or a one-letter typo on a token
 *    of 5+ letters ("GONZALES" / "GONZALEZ").
 * Short-token differences (IR/RF, JUAN/IVAN) never count, so IR COMMUNICATION
 * is not close to RF COMMUNICATION and JUAN VAZQUEZ is not close to IVAN VAZQUEZ.
 */
export function closeScore(a: string, b: string): number {
	const ta = tokens(a)
	const tb = tokens(b)
	if (ta.length === 0 || tb.length === 0) return 0
	const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
	if (small.length >= 2 && small.every((t) => large.includes(t))) {
		return small.length / large.length
	}
	if (ta.length === tb.length && ta.length >= 2) {
		const left = [...tb]
		let typos = 0
		for (const t of ta) {
			const exact = left.indexOf(t)
			if (exact !== -1) {
				left.splice(exact, 1)
				continue
			}
			const near = left.findIndex((u) => t.length >= 5 && withinOneEdit(t, u))
			if (near === -1) return 0
			left.splice(near, 1)
			typos++
		}
		return typos <= 1 ? 0.9 : 0
	}
	return 0
}

export function planBrigadeImport(
	rows: BrigadeImportRow[],
	existing: ExistingBrigade[],
	overrides: Record<string, string> = {},
): BrigadeImportPlan {
	const skipped: BrigadeImportPlan["skipped"] = []
	const ignoredOverrides: BrigadeImportPlan["ignoredOverrides"] = []
	const recodes: BrigadeRecode[] = []
	const suggestions: BrigadeSuggestion[] = []

	// First row wins for a code repeated inside the file.
	const seen = new Set<string>()
	const unique: BrigadeImportRow[] = []
	for (const row of rows) {
		if (seen.has(row.code)) {
			skipped.push({ code: row.code, reason: "duplicate_code_in_file" })
			continue
		}
		seen.add(row.code)
		unique.push(row)
	}
	const csvCodes = new Set(unique.map((r) => r.code))

	// Codes that are taken: by an existing brigade as it is now, or by a plan
	// decision. A CSV row whose code is claimed is never also created.
	const claimed = new Set<string>()
	const decided = new Set<string>() // brigade ids already handled
	const holder = new Map<string, string>() // code -> brigade id

	// 1. Existing code equals a CSV code: nothing to do.
	for (const b of existing) {
		if (b.code && csvCodes.has(b.code)) {
			claimed.add(b.code)
			decided.add(b.id)
			skipped.push({ code: b.code, reason: "unchanged" })
		}
		if (b.code) holder.set(b.code, b.id)
	}

	// Explicit overrides: a CSV code, or "" for "leave this brigade alone".
	const known = new Set(existing.map((b) => b.id))
	for (const [brigadeId, code] of Object.entries(overrides)) {
		if (!known.has(brigadeId)) {
			ignoredOverrides.push({ brigadeId, code, reason: "unknown_brigade" })
		}
	}
	for (const b of existing) {
		if (!(b.id in overrides)) continue
		const to = overrides[b.id]
		if (decided.has(b.id)) {
			if (to !== "" && to !== b.code) {
				ignoredOverrides.push({
					brigadeId: b.id,
					code: to,
					reason: "brigade_matched_by_code",
				})
			}
			continue
		}
		decided.add(b.id)
		if (to === "" || to === b.code) continue
		if (!csvCodes.has(to)) {
			ignoredOverrides.push({
				brigadeId: b.id,
				code: to,
				reason: "code_not_in_file",
			})
			continue
		}
		if (claimed.has(to)) {
			ignoredOverrides.push({
				brigadeId: b.id,
				code: to,
				reason: "code_claimed",
			})
			continue
		}
		claimed.add(to)
		recodes.push({ brigadeId: b.id, from: b.code, to, confidence: "manual" })
	}

	// 2. Same name (equipment accounts never match by name). One unclaimed
	// candidate recodes; several are ambiguous, so each is only suggested.
	const nameRows = unique.filter((r) => !r.isEquipmentAccount)
	for (const b of existing) {
		if (decided.has(b.id)) continue
		const hits = nameRows.filter(
			(r) => !claimed.has(r.code) && sameName(b.name, r.name),
		)
		if (hits.length === 0) continue
		decided.add(b.id)
		if (hits.length > 1) {
			for (const h of hits) {
				suggestions.push({
					brigadeId: b.id,
					csvCode: h.code,
					confidence: "close",
				})
			}
			continue
		}
		claimed.add(hits[0].code)
		recodes.push({
			brigadeId: b.id,
			from: b.code,
			to: hits[0].code,
			confidence: "name",
		})
	}

	// 3. Close names: suggest only.
	for (const b of existing) {
		if (decided.has(b.id)) continue
		let best: { code: string; score: number } | null = null
		for (const r of nameRows) {
			if (claimed.has(r.code)) continue
			const score = closeScore(b.name, r.name)
			if (score > 0 && (!best || score > best.score)) {
				best = { code: r.code, score }
			}
		}
		if (best) {
			suggestions.push({
				brigadeId: b.id,
				csvCode: best.code,
				confidence: "close",
			})
		}
	}

	// Rows claimed by a recode are not created; suggested rows still are,
	// because a suggestion is unconfirmed.
	const creates: BrigadeImportRow[] = []
	for (const row of unique) {
		if (holder.has(row.code)) continue
		if (claimed.has(row.code)) {
			skipped.push({ code: row.code, reason: "claimed" })
			continue
		}
		creates.push(row)
	}

	const flagged = unique.filter((r) => r.warning || r.checkWithLissette)
	return { recodes, suggestions, creates, skipped, flagged, ignoredOverrides }
}

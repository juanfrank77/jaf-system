/**
 * A packet Finance sent back to the supervisor ("Returned"), read from the
 * job's `financeSendBackNotes` JSON. Every return appends an entry; the
 * supervisor's resend stamps `resentAt` on the latest one, so the list is the
 * whole history (who, when, why) and the latest entry says where the packet is:
 * no `resentAt` means it is back with the supervisor. No column was added: the
 * entry shape grew an optional field.
 *
 * A returned packet keeps `releasedToFinanceAt` (Finance's own queues read it),
 * so every supervisor-facing reading of "released" has to ask `isReturned`.
 */
export type SendBackEntry = {
	note: string
	byUserId: string
	createdAt: string
	resentAt?: string
}

function isEntry(value: unknown): value is SendBackEntry {
	if (typeof value !== "object" || value === null) return false
	const e = value as Record<string, unknown>
	return (
		typeof e.note === "string" &&
		typeof e.byUserId === "string" &&
		typeof e.createdAt === "string" &&
		(e.resentAt === undefined || typeof e.resentAt === "string")
	)
}

/** Every well-formed return, oldest first; anything malformed is skipped. */
export function returnHistory(notes: unknown): SendBackEntry[] {
	return Array.isArray(notes) ? notes.filter(isEntry) : []
}

/** The most recent return, or null when the job was never sent back. */
export function latestReturn(doc: {
	financeSendBackNotes?: unknown
}): SendBackEntry | null {
	return returnHistory(doc.financeSendBackNotes).at(-1) ?? null
}

/**
 * The job fields that say whether a return is still live. A return only
 * matters while the packet sits at Finance's first step: released, not yet
 * verified, no LC request sent. Master wrote entries with no `resentAt`
 * before S4 and Finance verified those jobs after the fix, so the notes alone
 * would read "returned" forever.
 */
export type ReturnStateDoc = {
	financeSendBackNotes?: unknown
	releasedToFinanceAt: Date | string | null
	financeVerifiedAt: Date | string | null
	pbccRequestSentAt: Date | string | null
}

/** Released, unverified, no LC request: the only stage a return is live in. */
function atFinanceFirstStep(doc: ReturnStateDoc): boolean {
	return (
		!!doc.releasedToFinanceAt &&
		!doc.financeVerifiedAt &&
		!doc.pbccRequestSentAt
	)
}

/** Sent back by Finance and not yet resent: the supervisor has to fix it.
 * Never true once Finance verified the job or sent its LC request. */
export function isReturned(doc: ReturnStateDoc): boolean {
	if (!atFinanceFirstStep(doc)) return false
	const latest = latestReturn({
		financeSendBackNotes: doc.financeSendBackNotes,
	})
	return latest !== null && !latest.resentAt
}

/** The supervisor answered the latest return and Finance has not verified
 * it yet (the "Resent" chip). */
export function isResent(doc: ReturnStateDoc): boolean {
	if (!atFinanceFirstStep(doc)) return false
	return !!latestReturn({ financeSendBackNotes: doc.financeSendBackNotes })
		?.resentAt
}

/**
 * The notes with `resentAt` stamped on the latest return. Idempotent: an
 * already-resent latest entry keeps its first stamp. Never mutates `notes`;
 * anything that is not a list of returns comes back unchanged.
 */
export function markResent(notes: unknown, at: Date): unknown {
	if (!Array.isArray(notes)) return notes
	let index = -1
	for (let i = notes.length - 1; i >= 0; i--) {
		if (isEntry(notes[i])) {
			index = i
			break
		}
	}
	if (index === -1 || (notes[index] as SendBackEntry).resentAt) return notes
	return notes.map((entry, i) =>
		i === index ? { ...entry, resentAt: at.toISOString() } : entry,
	)
}

/**
 * Released and not sent back: Finance holds the packet, so the supervisor's
 * steps are locked. A returned packet is his again, exactly as before release.
 */
export function isWithFinance(doc: ReturnStateDoc): boolean {
	return !!doc.releasedToFinanceAt && !isReturned(doc)
}

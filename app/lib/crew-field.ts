import type { ServiceLine } from "./service-lines"

/**
 * A job with several crews records what each crew installed in
 * `JafInvoice.crewServiceLines`, one entry per brigade. `installedServiceLines`
 * stays the job total (the sum over crews) so the Aviso match, the packet and
 * Finance keep reading one list. A one-crew job has no `crewServiceLines`.
 */
export type CrewLines = { brigadeId: string; lines: ServiceLine[] }

/** Installed lines from a posted list: keeps zero quantities (a box typed 0). */
export function normalizeInstalled(list: unknown): ServiceLine[] {
	if (!Array.isArray(list)) throw new Error("Not a list")
	return (list as Record<string, unknown>[])
		.filter(
			(l) => l && typeof l.serviceCodeId === "string" && Number(l.qty) >= 0,
		)
		.map((l) => ({
			serviceCodeId: String(l.serviceCodeId),
			claroCode: String(l.claroCode ?? ""),
			accountCode: l.accountCode ? String(l.accountCode) : null,
			name: String(l.name ?? ""),
			qty: Number(l.qty),
			...(l.addedInField === true ? { addedInField: true as const } : {}),
		}))
}

/** The stored per-crew lines; anything unreadable is treated as none. */
export function readCrewLines(raw: unknown): CrewLines[] {
	if (!Array.isArray(raw)) return []
	return raw.flatMap((c) => {
		if (!c || typeof c.brigadeId !== "string" || !c.brigadeId) return []
		try {
			return [{ brigadeId: c.brigadeId, lines: normalizeInstalled(c.lines) }]
		} catch {
			return []
		}
	})
}

export function crewLinesOf(crews: CrewLines[], brigadeId: string) {
	return crews.find((c) => c.brigadeId === brigadeId)?.lines ?? []
}

/** `crews` with `brigadeId`'s lines replaced (appended when it had none). */
export function withCrewLines(
	crews: CrewLines[],
	brigadeId: string,
	lines: ServiceLine[],
): CrewLines[] {
	return crews.some((c) => c.brigadeId === brigadeId)
		? crews.map((c) => (c.brigadeId === brigadeId ? { ...c, lines } : c))
		: [...crews, { brigadeId, lines }]
}

/**
 * The job total: quantities summed per service, in the order first seen. A
 * service counts as added in the field when any crew added it.
 */
export function sumCrewLines(crews: CrewLines[]): ServiceLine[] {
	const total = new Map<string, ServiceLine>()
	for (const { lines } of crews)
		for (const l of lines) {
			const seen = total.get(l.serviceCodeId)
			total.set(
				l.serviceCodeId,
				seen
					? {
							...seen,
							qty: seen.qty + l.qty,
							...(seen.addedInField || l.addedInField
								? { addedInField: true as const }
								: {}),
						}
					: { ...l },
			)
		}
	return [...total.values()]
}

/**
 * The crews a post may carry lines for: exactly the brigades on the job.
 * Returns the posted crews in the job's order, or null when the post names a
 * brigade that is not on the job or repeats one.
 */
export function crewsOnJob(
	posted: CrewLines[],
	jobBrigadeIds: string[],
): CrewLines[] | null {
	const ids = posted.map((c) => c.brigadeId)
	if (new Set(ids).size !== ids.length) return null
	if (ids.some((id) => !jobBrigadeIds.includes(id))) return null
	return jobBrigadeIds.flatMap((id) => posted.filter((c) => c.brigadeId === id))
}

/** Which brigade holds each service line: the first one that has it. */
export function lineOwners(crews: CrewLines[]): Map<string, string> {
	const owners = new Map<string, string>()
	for (const { brigadeId, lines } of crews)
		for (const l of lines)
			if (!owners.has(l.serviceCodeId)) owners.set(l.serviceCodeId, brigadeId)
	return owners
}

/** A service line belongs to one brigade: true when two crews hold the same one. */
export function hasSplitLine(crews: CrewLines[]): boolean {
	const seen = new Set<string>()
	for (const { lines } of crews)
		for (const l of lines) {
			if (seen.has(l.serviceCodeId)) return true
			seen.add(l.serviceCodeId)
		}
	return false
}

/** The ordered lines no brigade has ticked yet. */
export function unassignedLines(
	ordered: ServiceLine[],
	crews: CrewLines[],
): ServiceLine[] {
	const owners = lineOwners(crews)
	return ordered.filter((l) => !owners.has(l.serviceCodeId))
}

/** Whether every brigade on the job has at least one installed line. */
export function everyCrewHasLines(
	crews: CrewLines[],
	jobBrigadeIds: string[],
): boolean {
	return jobBrigadeIds.every((id) => crewLinesOf(crews, id).length > 0)
}

/**
 * A work order can be assigned to several brigades. The first one is the
 * "lead": it stays in `JafInvoice.brigadeId`, and its code is what the
 * pre-cert signature copies into `contractorAccountCode` (the payee). Every
 * brigade's members land in `assignedCrewIds`; the full brigade list is
 * recorded on the latest `crewAssignmentHistory` entry as `brigadeIds`.
 */

export function parseBrigadeIds(form: FormData): string[] {
	const ids = form
		.getAll("brigadeId")
		.map((v) => (typeof v === "string" ? v.trim() : ""))
		.filter(Boolean)
	return [...new Set(ids)]
}

export function buildCrewAssignment(
	brigades: { id: string; memberIds: string[] }[],
) {
	return {
		brigadeId: brigades[0].id,
		brigadeIds: brigades.map((b) => b.id),
		assignedCrewIds: [...new Set(brigades.flatMap((b) => b.memberIds))],
	}
}

/**
 * `crewAssignmentHistory` is a JSON array. Docs created before this was fixed
 * hold it as a stringified array (a JSON string value), so accept both.
 */
export function readHistory(raw: unknown): Record<string, unknown>[] {
	if (Array.isArray(raw)) return raw
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw)
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	}
	return []
}

/** The brigades currently assigned, lead first. Older docs have no list. */
export function assignedBrigadeIds(doc: {
	brigadeId: string | null
	crewAssignmentHistory: unknown
}): string[] {
	const latest = readHistory(doc.crewAssignmentHistory).at(-1)
	if (latest && Array.isArray(latest.brigadeIds) && latest.brigadeIds.length)
		return latest.brigadeIds as string[]
	return doc.brigadeId ? [doc.brigadeId] : []
}

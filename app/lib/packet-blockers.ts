/**
 * Why step 5's "I sent the package to Claro" (and the email send) is refused
 * before the first send (spec "Packet → Claro", item 12):
 *
 * - `prefield_pdf`: the job's intake answer is "Prefield needed" and
 *   "Generate package" has not made the Prefield PDF yet. A job whose answer
 *   is "not needed" is never gated on it. This is the whole Prefield check.
 * - `blueprint`: the Claro supervisor requires a blueprint and none is
 *   attached.
 * - `stale`: an intake answer changed after the package was generated; it
 *   must be generated again.
 *
 * Material counts never gate anything.
 */
export type PacketBlocker = "prefield_pdf" | "blueprint" | "stale"

export function packetBlockers(
	doc: {
		prefieldNeeded: boolean
		prefieldPdfPath: string | null
		packetStale: boolean
		blueprintPaths: string[]
	},
	claro: { requiresBlueprint: boolean },
): PacketBlocker[] {
	const out: PacketBlocker[] = []
	if (doc.prefieldNeeded && !doc.prefieldPdfPath?.trim())
		out.push("prefield_pdf")
	if (claro.requiresBlueprint && doc.blueprintPaths.length === 0)
		out.push("blueprint")
	if (doc.packetStale) out.push("stale")
	return out
}

import { db } from "~/lib/db.server"
import { financeSendBackIds, stageWhere } from "~/lib/finance-stages.server"

/**
 * Where a packet sits in the Inbox (resent packets first, then oldest release
 * first: the order the list and Start reviewing use). `nextId` keeps going after the last packet by
 * wrapping to the oldest other one, so "Accept & next" never dead-ends while
 * other packets wait; it is null only when nothing else is in the Inbox.
 */
export async function inboxNeighbors(id: string): Promise<{
	total: number
	/** 1-based, 0 when the packet is not in the Inbox. */
	position: number
	prevId: string | null
	nextId: string | null
}> {
	// A packet sent back is not in the Inbox until it is resent (S4); a resent
	// one is listed first, as on Packets in.
	const { returned, resent } = await financeSendBackIds()
	const ordered = await db.jafInvoice.findMany({
		where: stageWhere("PACKETS", returned),
		orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
		select: { id: true },
	})
	const present = new Set(ordered.map((r) => r.id))
	const resentFirst = resent.filter((rid) => present.has(rid))
	const resentSet = new Set(resentFirst)
	const rows = [
		...resentFirst.map((rid) => ({ id: rid })),
		...ordered.filter((r) => !resentSet.has(r.id)),
	]
	const index = rows.findIndex((r) => r.id === id)
	const others = rows.filter((r) => r.id !== id)
	return {
		total: rows.length,
		position: index + 1,
		prevId: index > 0 ? rows[index - 1].id : null,
		nextId:
			(index >= 0 ? rows[index + 1] : rows[0])?.id ?? others[0]?.id ?? null,
	}
}

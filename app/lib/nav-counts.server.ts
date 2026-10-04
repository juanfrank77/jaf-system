import type { NavCount } from "~/components/nav-model"
import { db } from "~/lib/db.server"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import type { Role } from "../../generated/prisma/client"

/**
 * Per-role sidebar counts, keyed by nav `to`. Each department sub-project adds
 * its own role here; roles without an entry get no pills.
 */
export async function loadNavCounts(user: {
	id: string
	role: Role
}): Promise<Record<string, NavCount>> {
	if (user.role === "SUPERVISOR") {
		const areas = await supervisorAreas(db, user.id)
		const awaitingReview = await db.jafInvoice.count({
			where: { ...ownedOrInArea(user.id, areas), status: "FIELD_UPDATED" },
		})
		return { "/dashboard": { value: awaitingReview, tone: "critical" } }
	}
	return {}
}

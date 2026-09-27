import { redirect } from "react-router"
import type { PrismaClient } from "../../generated/prisma/client"

/**
 * The areas a supervisor owns, derived from the brigades they supervise.
 * Null-area brigades never contribute an area — a supervisor of one must
 * never gain access to every other null-area brigade in the system via
 * this list.
 */
export async function supervisorAreas(
	db: PrismaClient,
	userId: string,
): Promise<string[]> {
	const brigades = await db.brigade.findMany({
		where: { supervisorId: userId },
		select: { area: true },
		distinct: ["area"],
	})
	return brigades.flatMap((b) => (b.area ? [b.area] : []))
}

/**
 * Prisma where-fragment matching docs the supervisor either owns directly
 * (`supervisorId`) or that fall within one of the areas they supervise, via
 * their brigade's area. Shared by every supervisor-facing doc query so the
 * scope stays consistent across the dashboard, queues, and variance screen.
 */
export function ownedOrInArea(userId: string, areas: string[]) {
	return {
		OR: [
			{ supervisorId: userId },
			{ brigade: { is: { area: { in: areas } } } },
		],
	}
}

/**
 * Throws a redirect to /dashboard unless the doc belongs to the supervisor
 * directly, or falls within one of the areas the supervisor owns.
 */
export async function assertDocInSupervisorScope(
	db: PrismaClient,
	userId: string,
	doc: {
		supervisorId: string | null
		brigade?: { area: string | null } | null
	},
) {
	if (doc.supervisorId === userId) return
	const areas = await supervisorAreas(db, userId)
	if (!doc.brigade?.area || !areas.includes(doc.brigade.area))
		throw redirect("/dashboard")
}

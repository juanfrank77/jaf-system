import { redirect } from "react-router"
import type { PrismaClient } from "../../generated/prisma/client"

/** The canonical area set (Global Constraints: `Brigade.area`). */
export const ALL_AREAS = ["CENTRAL", "METRO", "NORTE", "OESTE", "SUR"] as const

/**
 * The areas a supervisor is authorized to act in. This is admin-managed
 * data on `User.supervisorAreas` — never derived from the brigades a
 * supervisor happens to own. `Brigade.area` and `Brigade.supervisorId` are
 * ordinary editable fields; deriving authorization from them turns every
 * brigade edit into a privilege-escalation primitive, which is exactly the
 * bug class this function exists to avoid re-introducing.
 */
export async function supervisorAreas(
	db: PrismaClient,
	userId: string,
): Promise<string[]> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { supervisorAreas: true },
	})
	return user?.supervisorAreas ?? []
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

/**
 * Whether `brigade` falls within the given supervisor's admin-assigned
 * areas — i.e. whether it's a valid reassignment/edit target for them.
 * This function only ever answers that question for a SUPERVISOR; every
 * caller must independently gate the call on `user.role === "SUPERVISOR"`
 * (non-supervisor roles bypass this check entirely rather than calling it).
 * Shared by every route that lets a supervisor point a doc at a brigade, so
 * the reassign-target check can't silently drift between routes.
 */
export async function isBrigadeInSupervisorScope(
	db: PrismaClient,
	userId: string,
	brigade: { area: string | null } | null,
): Promise<boolean> {
	if (!brigade) return false
	const areas = await supervisorAreas(db, userId)
	return !!brigade.area && areas.includes(brigade.area)
}

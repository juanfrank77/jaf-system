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
	// Defensive: the stored value should already be canonical and trimmed
	// (the admin editor validates on write), but this is authorization data —
	// never trust it blindly. A stray non-canonical or untrimmed value (e.g.
	// from a data-migration backfill that copied `Brigade.area` verbatim)
	// must never silently deny every action for that supervisor, nor grant
	// scope over an area that doesn't exist.
	const raw = user?.supervisorAreas ?? []
	return raw
		.map((a) => a.trim())
		.filter((a): a is (typeof ALL_AREAS)[number] =>
			(ALL_AREAS as readonly string[]).includes(a),
		)
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

/**
 * `db.brigade.findMany` args for the "pick a brigade to assign this job to"
 * picker every doc-intake/edit/reassign screen renders — active brigades
 * only, scoped and bounded for a SUPERVISOR (their own admin-assigned areas,
 * capped so the picker can't blow up), unscoped and unbounded for anyone
 * else (ADMIN sees every active brigade, matching its pre-existing
 * behavior). Shared so the `active`/`take`/scope rule can't drift between
 * routes the way it already had once. Not for the Comptroller's
 * brigade-management screen (`/comptroller/brigades`), which intentionally
 * shows inactive brigades too so they can be reactivated.
 */
export async function assignableBrigadesWhere(
	db: PrismaClient,
	user: { id: string; role: string },
): Promise<{
	where: { active: true; area?: { in: string[] } }
	take: number | undefined
}> {
	if (user.role !== "SUPERVISOR") {
		return { where: { active: true }, take: undefined }
	}
	const areas = await supervisorAreas(db, user.id)
	return { where: { active: true, area: { in: areas } }, take: 100 }
}

import { redirect } from "react-router"
import type { PrismaClient } from "../../generated/prisma/client"

/** The areas a supervisor owns, derived from the brigades they supervise. */
export async function supervisorAreas(db: PrismaClient, userId: string) {
	const brigades = await db.brigade.findMany({
		where: { supervisorId: userId },
		select: { area: true },
		distinct: ["area"],
	})
	return brigades.map((b) => b.area)
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
	if (!doc.brigade || !areas.includes(doc.brigade.area))
		throw redirect("/dashboard")
}

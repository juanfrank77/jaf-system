import { redirect } from "react-router"
import type { Role } from "../../generated/prisma/client"
import { auth } from "./auth.server"
import { db } from "./db.server"
import {
	canTransition,
	EDITABLE_STATUSES,
	isEditableStatus,
	isReviewActionStatus,
	isTerminalStatus,
	REVIEW_ACTION_STATUSES,
	TERMINAL_STATUSES,
} from "./permissions"

export {
	canTransition,
	EDITABLE_STATUSES,
	isEditableStatus,
	isReviewActionStatus,
	isTerminalStatus,
	REVIEW_ACTION_STATUSES,
	TERMINAL_STATUSES,
}

export async function requireSession(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers })
	if (!session) throw redirect("/login")
	return session
}

export async function requireRole(request: Request, allowed: Role[]) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	if (!allowed.includes(user.role)) throw redirect("/dashboard")
	return { session, user }
}

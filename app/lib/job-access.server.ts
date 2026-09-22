import type { Role } from "../../generated/prisma/client"

type AccessUser = { id: string; role: Role }
type AccessDoc = { supervisorId: string }

export function requireJobAccess(
	user: AccessUser,
	doc: AccessDoc,
	_mode: "read" | "write",
): void {
	if (user.role === "ADMIN") return
	if (user.role === "SUPERVISOR" && doc.supervisorId !== user.id) {
		throw new Response("Not Found", { status: 404 })
	}
}

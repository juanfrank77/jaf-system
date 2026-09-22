import type { Role } from "../../generated/prisma/client"

type ScopeUser = { id: string; role: Role }

export function activeBrigadesWhere(user: ScopeUser) {
	if (user.role === "SUPERVISOR") {
		return { active: true, supervisorId: user.id } as const
	}
	return { active: true } as const
}

export function isBrigadeInScope(
	user: ScopeUser,
	brigade: { supervisorId: string | null },
): boolean {
	if (user.role === "ADMIN") return true
	if (user.role === "SUPERVISOR") return brigade.supervisorId === user.id
	return true
}

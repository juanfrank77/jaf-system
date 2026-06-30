import { redirect } from 'react-router'
import { auth } from './auth.server'
import { db } from './db.server'
import type { Role } from '@prisma/client'

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect('/login')
  return session
}

export async function requireRole(request: Request, allowed: Role[]) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })
  if (!allowed.includes(user.role)) throw redirect('/dashboard')
  return { session, user }
}

// State machine: which transitions are allowed
const TRANSITIONS: Record<string, { from: string; roles: Role[] }> = {
  PREPPED:             { from: 'CREATED',              roles: ['WAREHOUSE', 'ADMIN'] },
  SIGNED:              { from: 'PREPPED',              roles: ['CREW', 'WAREHOUSE', 'ADMIN'] },
  // FIELD_UPDATED accepts from 'SIGNED' (warehouse path) OR CREATED (van bypass path)
  FIELD_UPDATED:       { from: ['SIGNED', 'CREATED'],  roles: ['CREW', 'ADMIN'] },
  SUPERVISOR_APPROVED: { from: 'FIELD_UPDATED',        roles: ['SUPERVISOR', 'ADMIN'] },
  CLARO_UPLOADED:      { from: 'SUPERVISOR_APPROVED',  roles: ['SUPERVISOR', 'ADMIN'] },
  LC_GENERATED:        { from: 'CLARO_UPLOADED',       roles: ['FINANCE', 'ADMIN'] },
}

export function canTransition(currentStatus: string, targetStatus: string, role: Role): boolean {
  const rule = TRANSITIONS[targetStatus]
  if (!rule) return false
  const validFrom = Array.isArray(rule.from) ? rule.from : [rule.from]
  return validFrom.includes(currentStatus) && rule.roles.includes(role)
}

import type { Role } from "../../generated/prisma/client"

// Kept as a local literal, not a runtime import of the Prisma Role enum:
// this file is imported by route modules whose component half is bundled
// for the browser, and importing the generated Prisma client at runtime
// there pulls in Node built-ins (node:url) that break in that context.
const ALL_ROLES: Role[] = [
	"SUPERVISOR",
	"CREW",
	"WAREHOUSE",
	"FINANCE",
	"ADMIN",
	"INSTALLER",
	"COMPTROLLER",
	"INSTALLER_SUPERVISOR",
]

const EDITABLE_STATUSES = ["CREATED", "PREPPED"] as const
type EditableStatus = (typeof EDITABLE_STATUSES)[number]

export function isEditableStatus(status: string): status is EditableStatus {
	return EDITABLE_STATUSES.includes(status as EditableStatus)
}

// A crew can be swapped until it has reported from the field. Once the field
// update is in (or the job is approved, sent to Claro, in Finance), the crew
// that did the work is the one that gets paid. A send-back returns the job to
// SIGNED, which makes it reassignable again.
const REASSIGNABLE_STATUSES = ["CREATED", "PREPPED", "SIGNED"] as const

export function isReassignableStatus(status: string): boolean {
	return REASSIGNABLE_STATUSES.includes(
		status as (typeof REASSIGNABLE_STATUSES)[number],
	)
}

const REVIEW_ACTION_STATUSES = ["FIELD_UPDATED", "SUPERVISOR_APPROVED"] as const
type ReviewActionStatus = (typeof REVIEW_ACTION_STATUSES)[number]

export function isReviewActionStatus(
	status: string,
): status is ReviewActionStatus {
	return REVIEW_ACTION_STATUSES.includes(status as ReviewActionStatus)
}

const TERMINAL_STATUSES = ["CANCELLED", "LC_REQUEST_GENERATED"] as const
type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

export function isTerminalStatus(status: string): status is TerminalStatus {
	return TERMINAL_STATUSES.includes(status as TerminalStatus)
}

// State machine: which transitions are allowed
const TRANSITIONS: Record<string, { from: string | string[]; roles: Role[] }> =
	{
		PREPPED: { from: ["CREATED", "PREPPED"], roles: ["WAREHOUSE", "ADMIN"] },
		SIGNED: { from: "PREPPED", roles: ["CREW", "WAREHOUSE", "ADMIN"] },
		FIELD_UPDATED: { from: "SIGNED", roles: ["SUPERVISOR", "ADMIN"] },
		SUPERVISOR_APPROVED: {
			from: "FIELD_UPDATED",
			roles: ["SUPERVISOR", "ADMIN"],
		},
		CLARO_UPLOADED: {
			from: "SUPERVISOR_APPROVED",
			roles: ["SUPERVISOR", "ADMIN"],
		},
		LC_REQUEST_GENERATED: {
			from: "CLARO_UPLOADED",
			roles: ["FINANCE", "ADMIN"],
		},
	}

export function canReleaseToVan(role: Role): boolean {
	return role === "WAREHOUSE" || role === "ADMIN"
}
export function canApproveRestock(role: Role): boolean {
	return role === "INSTALLER_SUPERVISOR" || role === "ADMIN"
}
export function canScanInReturn(role: Role): boolean {
	return role === "WAREHOUSE" || role === "ADMIN"
}

/** Derives the requireRole() allow-list from a can*() predicate, so the
 * predicate stays the single source of truth for a route's authorization
 * instead of a second, separately-maintained role array. */
export function rolesMatching(predicate: (role: Role) => boolean): Role[] {
	return ALL_ROLES.filter(predicate)
}

export function canTransition(
	currentStatus: string,
	targetStatus: string,
	role: Role,
): boolean {
	const rule = TRANSITIONS[targetStatus]
	if (!rule) return false
	const validFrom = Array.isArray(rule.from) ? rule.from : [rule.from]
	return validFrom.includes(currentStatus) && rule.roles.includes(role)
}

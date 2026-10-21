/**
 * JAF rule: a supervisor may correct a work order (mistyped or wrong data)
 * at most three times. After that the work order is cancelled and a new one
 * created. Every saved edit writes a WORK_ORDER_EDITED audit row, so the
 * rows are the counter. Admins are not limited.
 */
export const MAX_SUPERVISOR_EDITS = 3

export const WORK_ORDER_EDITED = "WORK_ORDER_EDITED"

export function countWorkOrderEdits(rows: { action: string }[]): number {
	return rows.filter((r) => r.action === WORK_ORDER_EDITED).length
}

export function supervisorEditsLeft(used: number): number {
	return Math.max(0, MAX_SUPERVISOR_EDITS - used)
}

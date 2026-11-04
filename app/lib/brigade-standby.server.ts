import { syncContractorAccount } from "~/lib/contractor-account-sync"
import { assignedBrigadeIds } from "~/lib/crew-assignment"
import { supervisorAreas } from "~/lib/supervisor-scope"
import type { PrismaClient } from "../../generated/prisma/client"

export const BRIGADE_STANDBY = "BRIGADE_STANDBY"

export const STANDBY_NOT_FOUND = "supervisor_brigades.errors.not_found"
export const STANDBY_NOT_YOURS = "supervisor_brigades.errors.not_yours"
export const STANDBY_ON_A_JOB = "supervisor_brigades.errors.on_a_job"

/** Statuses where a brigade still has work to do on a job. */
const WORK_STATUSES = ["CREATED", "PREPPED", "SIGNED", "FIELD_UPDATED"] as const

export type StandByResult = { ok: true } | { ok: false; errorKey: string }

/**
 * Put a brigade on stand-by: inactive and unowned, so it goes back to the pool
 * any supervisor can activate from the picker. Allowed for the brigade's own
 * supervisor or a supervisor whose admin-assigned areas contain its area, and
 * never while it is on a job in progress. The `ContractorAccount` stays: the
 * pay sweep ignores `active`, so finished jobs are still paid.
 */
export async function standByBrigade(
	db: PrismaClient,
	{ brigadeId, viewerId }: { brigadeId: string; viewerId: string },
): Promise<StandByResult> {
	const brigade = await db.brigade.findUnique({ where: { id: brigadeId } })
	if (!brigade || brigade.isEquipmentAccount || brigade.terminatedAt)
		return { ok: false, errorKey: STANDBY_NOT_FOUND }

	// Already on stand-by: nothing to change, nothing to leak.
	if (!brigade.active) return { ok: true }

	if (brigade.supervisorId !== viewerId) {
		const areas = await supervisorAreas(db, viewerId)
		if (!brigade.area || !areas.includes(brigade.area))
			return { ok: false, errorKey: STANDBY_NOT_YOURS }
	}

	const jobs = await db.jafInvoice.findMany({
		where: { status: { in: [...WORK_STATUSES] } },
		select: { brigadeId: true, crewAssignmentHistory: true },
	})
	// The lead is a column but the rest live in the assignment history (JSON),
	// so match in code via assignedBrigadeIds.
	if (jobs.some((j) => assignedBrigadeIds(j).includes(brigadeId)))
		return { ok: false, errorKey: STANDBY_ON_A_JOB }

	await db.$transaction(async (tx) => {
		const fresh = await tx.brigade.updateMany({
			where: { id: brigadeId, active: true },
			data: { active: false, supervisorId: null },
		})
		if (fresh.count === 0) return
		await tx.brigadeEvent.create({
			data: {
				brigadeId,
				userId: viewerId,
				docId: null,
				action: BRIGADE_STANDBY,
				diffJson: {
					before: { active: true, supervisorId: brigade.supervisorId },
					after: { active: false, supervisorId: null },
				},
			},
		})
		await syncContractorAccount(tx, {
			id: brigade.id,
			name: brigade.name,
			code: brigade.code,
			active: false,
		})
	})
	return { ok: true }
}

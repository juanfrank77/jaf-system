import type { Prisma, PrismaClient } from "../../generated/prisma/client"
import { assignRejection, type PickerViewer } from "./brigade-picker"
import { syncContractorAccount } from "./contractor-account-sync"
import { supervisorAreas } from "./supervisor-scope"

export const BRIGADE_INVALID = "docs_new.errors.brigade_invalid"
export const BRIGADE_ACTIVATED = "BRIGADE_ACTIVATED"

/**
 * The picker viewer for `user`: a SUPERVISOR carries their admin-assigned
 * areas; every other role has none (and needs no lookup).
 */
export async function pickerViewer(
	db: PrismaClient,
	user: { id: string; role: string },
): Promise<PickerViewer> {
	return {
		id: user.id,
		role: user.role,
		areas: user.role === "SUPERVISOR" ? await supervisorAreas(db, user.id) : [],
	}
}

/** When each brigade last had a job (as first crew), for the picker's "last worked". */
export async function lastWorkedByBrigade(
	db: PrismaClient,
): Promise<Map<string, Date>> {
	const rows = await db.jafInvoice.groupBy({
		by: ["brigadeId"],
		where: { brigadeId: { not: null } },
		_max: { createdAt: true },
	})
	const out = new Map<string, Date>()
	for (const r of rows)
		if (r.brigadeId && r._max.createdAt) out.set(r.brigadeId, r._max.createdAt)
	return out
}

type Tx = Pick<
	Prisma.TransactionClient,
	"brigade" | "brigadeEvent" | "contractorAccount"
>

/**
 * The server-side brigade guard for every path that puts brigades on a job
 * (create, edit, reassign). Run it inside the job's own
 * transaction: the activation and the job save succeed or fail together.
 *
 * Rejects unknown, equipment and terminated brigades (`BRIGADE_INVALID`, every
 * role). A SUPERVISOR may add any other brigade, another supervisor's
 * included. Their inactive ones are activated ("Activate and add") and logged
 * to `BrigadeEvent` against `docId`: an unowned or own brigade becomes theirs,
 * one with another supervisor stays with its owner. The activation is a
 * conditional update on `active: false`, so of two saves activating the same
 * brigade at once exactly one logs it. An Admin's pick changes nothing on the
 * brigade.
 *
 * On `{ ok: false }` an earlier brigade may already be activated in `tx`: the
 * caller must roll the transaction back (`assignBrigadesOrThrow` does).
 */
export async function assignBrigades(
	tx: Tx,
	{
		docId,
		viewer,
		brigadeIds,
	}: { docId: string | null; viewer: PickerViewer; brigadeIds: string[] },
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
	const ids = [...new Set(brigadeIds)]
	const rows = await tx.brigade.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			name: true,
			code: true,
			area: true,
			active: true,
			supervisorId: true,
			isEquipmentAccount: true,
			terminatedAt: true,
		},
	})
	if (rows.length !== ids.length)
		return { ok: false, errorKey: BRIGADE_INVALID }
	for (const b of rows) {
		const rejection = assignRejection(b, viewer)
		if (rejection === "invalid") return { ok: false, errorKey: BRIGADE_INVALID }
	}
	if (viewer.role !== "SUPERVISOR") return { ok: true }

	// A fixed order, so two saves activating the same brigades lock them in the
	// same sequence and cannot deadlock.
	const toActivate = rows
		.filter((b) => !b.active)
		.sort((a, b) => a.id.localeCompare(b.id))
	for (const b of toActivate) {
		// An unowned or own brigade becomes the viewer's; one with another
		// supervisor is activated and stays with them ("usually with ...").
		const claim = !b.supervisorId || b.supervisorId === viewer.id
		const { count } = await tx.brigade.updateMany({
			where: {
				id: b.id,
				active: false,
				isEquipmentAccount: false,
				terminatedAt: null,
			},
			data: claim
				? { active: true, supervisorId: viewer.id }
				: { active: true },
		})
		// 0 rows: another save activated it first. It is assignable either way,
		// so this save carries on without a second event.
		if (count === 0) continue
		await tx.brigadeEvent.create({
			data: {
				brigadeId: b.id,
				userId: viewer.id,
				docId,
				action: BRIGADE_ACTIVATED,
				diffJson: {
					before: { active: false, supervisorId: b.supervisorId },
					after: {
						active: true,
						supervisorId: claim ? viewer.id : b.supervisorId,
					},
				},
			},
		})
		await syncContractorAccount(tx, {
			id: b.id,
			name: b.name,
			code: b.code,
			active: true,
		})
	}
	return { ok: true }
}

/** Carries `assignBrigades`' error key out of a transaction, rolling it back. */
export class BrigadeAssignError extends Error {
	readonly errorKey: string
	constructor(errorKey: string) {
		super(errorKey)
		this.name = "BrigadeAssignError"
		this.errorKey = errorKey
	}
}

/** `assignBrigades`, throwing `BrigadeAssignError` so the caller's transaction rolls back. */
export async function assignBrigadesOrThrow(
	tx: Tx,
	args: Parameters<typeof assignBrigades>[1],
): Promise<void> {
	const result = await assignBrigades(tx, args)
	if (!result.ok) throw new BrigadeAssignError(result.errorKey)
}

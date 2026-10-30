import type { Prisma, PrismaClient } from "../../generated/prisma/client"
import type { BrigadeImportPlan } from "./brigade-import-plan"
import { syncContractorAccount } from "./contractor-account-sync"

/** The data changed between the preview and the apply; the user must re-preview. */
export class BrigadeImportStaleError extends Error {
	constructor(public brigadeId: string) {
		super("The brigades changed since the preview; run the preview again.")
		this.name = "BrigadeImportStaleError"
	}
}

/**
 * Apply a `planBrigadeImport` plan in one transaction: a failing row rolls the
 * whole import back.
 *
 * Creates are inactive, with no area or supervisor, and get an (inactive)
 * `ContractorAccount`; they are written in bulk (one lookup, one createMany for
 * brigades, one for accounts) so ~170 rows stay well inside the transaction
 * timeout on a remote database. Recodes change ONLY `Brigade.code`; the account
 * under the old code stays so jobs already signed under it still resolve, and
 * the new code's account follows the brigade's current `active`. A recode whose
 * brigade no longer has the plan's `from` code throws `BrigadeImportStaleError`.
 * Idempotent: a code that already exists is not created again, and a brigade
 * already on its target code is not recoded. `actorId` is part of the signature
 * for the audit log that a later step adds; nothing is written for it yet.
 *
 * An account already under a code is moved to the brigade that now holds the
 * code only when it is an orphan. One whose brigade still exists under another
 * code (it was recoded away and the account keeps paying its old jobs) is
 * left alone and its code is returned in `keptAccounts` for the screen.
 */
export async function applyBrigadeImport(
	db: PrismaClient,
	plan: BrigadeImportPlan,
	_actorId: string,
): Promise<{ created: number; recoded: number; keptAccounts: string[] }> {
	return db.$transaction(
		async (tx) => {
			const keptAccounts: string[] = []
			const sync = async (brigade: {
				id: string
				name: string
				code: string | null
				active: boolean
			}) => {
				if (await paysAnotherBrigade(tx, brigade)) {
					keptAccounts.push(brigade.code as string)
					return
				}
				await syncContractorAccount(tx, brigade)
			}
			// --- creates ---
			const seen = new Set<string>()
			const wanted = plan.creates.filter((r) => {
				if (seen.has(r.code)) return false
				seen.add(r.code)
				return true
			})
			const taken = new Set(
				(
					await tx.brigade.findMany({
						where: { code: { in: wanted.map((r) => r.code) } },
						select: { code: true },
					})
				).map((b) => b.code),
			)
			const fresh = wanted.filter((r) => !taken.has(r.code))
			if (fresh.length > 0) {
				await tx.brigade.createMany({
					data: fresh.map((r) => ({
						name: r.name,
						code: r.code,
						memberIds: [],
						active: false,
						isEquipmentAccount: r.isEquipmentAccount,
						baseCode: r.baseCode,
					})),
				})
				const made = await tx.brigade.findMany({
					where: { code: { in: fresh.map((r) => r.code) } },
					select: { id: true, name: true, code: true, active: true },
				})
				const haveAccount = new Set(
					(
						await tx.contractorAccount.findMany({
							where: { code: { in: fresh.map((r) => r.code) } },
							select: { code: true },
						})
					).map((a) => a.code),
				)
				const missing = made.filter((b) => !haveAccount.has(b.code as string))
				if (missing.length > 0) {
					await tx.contractorAccount.createMany({
						data: missing.map((b) => ({
							code: b.code as string,
							label: b.name,
							brigadeId: b.id,
							active: false,
						})),
					})
				}
				// An orphan account already under the code is re-pointed.
				for (const b of made.filter((b) => haveAccount.has(b.code as string))) {
					await sync(b)
				}
			}

			// --- recodes ---
			let recoded = 0
			for (const r of plan.recodes) {
				const current = await tx.brigade.findUnique({
					where: { id: r.brigadeId },
				})
				if (!current) throw new BrigadeImportStaleError(r.brigadeId)
				if (current.code === r.to) continue
				if (current.code !== r.from) {
					throw new BrigadeImportStaleError(r.brigadeId)
				}
				const brigade = await tx.brigade.update({
					where: { id: r.brigadeId },
					data: { code: r.to },
				})
				await sync(brigade)
				recoded++
			}

			return { created: fresh.length, recoded, keptAccounts }
		},
		{ timeout: 60_000, maxWait: 10_000 },
	)
}

/**
 * The account under `brigade.code` belongs to another brigade that still
 * exists under a different code: re-pointing it would move that brigade's
 * signed jobs to this one.
 */
async function paysAnotherBrigade(
	tx: Prisma.TransactionClient,
	brigade: { id: string; code: string | null },
): Promise<boolean> {
	if (!brigade.code) return false
	const account = await tx.contractorAccount.findUnique({
		where: { code: brigade.code },
		select: { brigadeId: true },
	})
	if (!account?.brigadeId || account.brigadeId === brigade.id) return false
	const owner = await tx.brigade.findUnique({
		where: { id: account.brigadeId },
		select: { code: true },
	})
	return !!owner && owner.code !== brigade.code
}

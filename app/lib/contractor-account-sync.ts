import type { PrismaClient } from "../../generated/prisma/client"

type AccountClient = { contractorAccount: PrismaClient["contractorAccount"] }

/**
 * Keep a brigade's `ContractorAccount` in step with the brigade.
 *
 * `JafInvoice.contractorAccountCode` is copied from `Brigade.code` at
 * sub-contractor signature and resolved against `ContractorAccount.code` at
 * sweep time, so a brigade that has a code but no account is a job the sweep
 * can never pick up. The seed and the brigades screen both call this, so a code
 * entered later (a brigade whose number was not yet confirmed) maps without a
 * re-seed.
 *
 * `active` is the "takes new work" half of q&a 14.4 — it is NOT consulted when
 * sweeping, so a deactivated brigade is still paid for work already released.
 * A brigade without a code has no account to sync; returns false.
 *
 * Idempotent: upsert on the unique `code`. An account under a brigade's
 * previous code is left in place so jobs already signed under it still resolve.
 */
export async function syncContractorAccount(
	client: AccountClient,
	brigade: { id: string; name: string; code: string | null; active: boolean },
): Promise<boolean> {
	if (!brigade.code) return false
	await client.contractorAccount.upsert({
		where: { code: brigade.code },
		update: {
			brigadeId: brigade.id,
			label: brigade.name,
			active: brigade.active,
		},
		create: {
			code: brigade.code,
			label: brigade.name,
			brigadeId: brigade.id,
			active: brigade.active,
		},
	})
	return true
}

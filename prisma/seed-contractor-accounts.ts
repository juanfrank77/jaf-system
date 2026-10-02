import type { PrismaClient } from "../generated/prisma/client"

/**
 * Seed one ContractorAccount per Brigade, keyed on the brigade's code.
 *
 * `JafInvoice.contractorAccountCode` is copied from `Brigade.code` at
 * sub-contractor signature, and `resolveContractorAccounts` resolves that code
 * against these rows at sweep time — so an active brigade with no account here
 * is a job the sweep can never pick up (it stays open on L1, flagged
 * "account not mapped").
 *
 * `active` is synced from the brigade so that deactivating a brigade (PDF Part 3
 * §14.4, OPEN — waiting on Monica) also deactivates its account. An inactive
 * account is filtered out by `resolveContractorAccounts`, which means jobs under
 * a deactivated brigade stay open on L1 and are NOT swept into a new run — but
 * jobs already swept into a run are frozen and will close regardless, so the
 * brigade still gets paid for work already released.
 *
 * Idempotent: upsert on the unique `code`. Lives in its own module (like
 * `seed-warehouse-stock.ts`) rather than in `seed.ts` so tests can import and
 * call it without `seed.ts`'s module-level `main()` running the whole seed.
 */
export async function seedContractorAccounts(db: PrismaClient): Promise<void> {
	const brigades = await db.brigade.findMany({
		where: { code: { not: null } },
		select: { id: true, name: true, code: true, active: true },
	})
	let upserted = 0
	for (const brigade of brigades) {
		await db.contractorAccount.upsert({
			where: { code: brigade.code as string },
			update: {
				brigadeId: brigade.id,
				label: brigade.name,
				active: brigade.active,
			},
			create: {
				code: brigade.code as string,
				label: brigade.name,
				brigadeId: brigade.id,
				active: brigade.active,
			},
		})
		upserted++
	}
	// biome-ignore lint/suspicious/noConsole: seed output
	console.log(`contractor accounts: ${upserted} upserted`)
}

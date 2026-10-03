import type { PrismaClient } from "../generated/prisma/client"

/**
 * Seed one ContractorAccount per Brigade, keyed on the brigade's code.
 *
 * `JafInvoice.contractorAccountCode` is copied from `Brigade.code` at
 * sub-contractor signature, and `resolveContractorAccounts` resolves that code
 * against these rows at sweep time — so a brigade with no account here is a
 * job the sweep can never pick up (it stays open on L1, flagged "account not
 * mapped").
 *
 * `active` is synced from the brigade, which is the "takes new work" half of
 * q&a 14.4. It gates the assignment pickers in supervisor-scope.ts and the
 * L1 queue — a deactivated brigade is unassignable — but it is NOT swept
 * out of `generateRun`. The sweep resolves the account regardless of active,
 * so the brigade still gets paid for work already released. Jobs already in a
 * run are frozen and close regardless.
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

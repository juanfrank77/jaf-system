import type { PrismaClient } from "../generated/prisma/client"

/**
 * Seed one ContractorAccount per active Brigade, keyed on the brigade's code.
 *
 * `JafInvoice.contractorAccountCode` is copied from `Brigade.code` at
 * sub-contractor signature, and `generateRun` resolves that code against these
 * rows — so an active brigade with no account here is a job the sweep can
 * never pick up (it stays open on L1, flagged "account not mapped").
 *
 * Idempotent: upsert on the unique `code`. Lives in its own module (like
 * `seed-warehouse-stock.ts`) rather than in `seed.ts` so tests can import and
 * call it without `seed.ts`'s module-level `main()` running the whole seed.
 */
export async function seedContractorAccounts(db: PrismaClient): Promise<void> {
	const brigades = await db.brigade.findMany({
		where: { active: true },
		select: { id: true, name: true, code: true },
	})
	let upserted = 0
	for (const brigade of brigades) {
		if (!brigade.code) continue
		await db.contractorAccount.upsert({
			where: { code: brigade.code },
			update: { brigadeId: brigade.id, label: brigade.name },
			create: {
				code: brigade.code,
				label: brigade.name,
				brigadeId: brigade.id,
			},
		})
		upserted++
	}
	// biome-ignore lint/suspicious/noConsole: seed output
	console.log(`contractor accounts: ${upserted} upserted`)
}

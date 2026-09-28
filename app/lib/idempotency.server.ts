import type { db as _db } from "~/lib/db.server"
import { Prisma } from "../../generated/prisma/client"

type DB = typeof _db

/**
 * Run `fn` at most once for a given `key`. The key is inserted inside the same
 * transaction as `fn`, so a concurrent or replayed call with the same key hits
 * the unique-PK violation (P2002) and short-circuits with `deduped: true`,
 * having performed no writes. `IdempotencyKey`'s PK is `key` alone (scope is
 * stored for audit, not uniqueness), so callers must namespace `key` fully.
 */
export async function runOnce<T>(
	db: DB,
	key: string,
	scope: string,
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ deduped: false; result: T } | { deduped: true }> {
	try {
		return await db.$transaction(async (tx) => {
			await tx.idempotencyKey.create({ data: { key, scope } }) // unique PK; throws P2002 on replay
			const result = await fn(tx)
			return { deduped: false as const, result }
		})
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
			return { deduped: true as const }
		throw e
	}
}

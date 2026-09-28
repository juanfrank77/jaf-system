import type { db as _db } from "~/lib/db.server"
import { Prisma } from "../../generated/prisma/client"

type DB = typeof _db

/**
 * Sentinel for "this exact idempotency key was already inserted".
 *
 * It exists so the dedup branch can be keyed on WHERE the P2002 came from, not
 * merely on its code: a genuine unique-constraint violation raised by the
 * wrapped operation itself (a duplicate serial, a duplicate control number, …)
 * used to be swallowed by the same catch and reported as `deduped: true` — a
 * false success for an operation that actually failed and wrote nothing.
 */
class IdempotencyKeyConflict extends Error {}

/**
 * Run `fn` at most once for a given `key`. The key is inserted inside the same
 * transaction as `fn`, so a concurrent or replayed call with the same key hits
 * the unique-PK violation (P2002) and short-circuits with `deduped: true`,
 * having performed no writes. `IdempotencyKey`'s PK is `key` alone (scope is
 * stored for audit, not uniqueness), so callers must namespace `key` fully.
 *
 * Any error thrown by `fn` — including a P2002 of its own — propagates.
 */
export async function runOnce<T>(
	db: DB,
	key: string,
	scope: string,
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ deduped: false; result: T } | { deduped: true }> {
	try {
		return await db.$transaction(async (tx) => {
			try {
				await tx.idempotencyKey.create({ data: { key, scope } }) // unique PK
			} catch (e) {
				if (
					e instanceof Prisma.PrismaClientKnownRequestError &&
					e.code === "P2002"
				)
					throw new IdempotencyKeyConflict(key) // replay: not an error
				throw e
			}
			const result = await fn(tx)
			return { deduped: false as const, result }
		})
	} catch (e) {
		if (e instanceof IdempotencyKeyConflict) return { deduped: true as const }
		throw e
	}
}

import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { runOnce } from "~/lib/idempotency.server"
import { runToken } from "~/test/helpers"

const keys: string[] = []
afterAll(async () => {
	if (keys.length)
		await db.idempotencyKey.deleteMany({ where: { key: { in: keys } } })
})

describe("runOnce", () => {
	it("runs fn once and dedupes a replay with the same key", async () => {
		let calls = 0
		const key = runToken("idem")
		keys.push(key)
		const a = await runOnce(db, key, "returns", async () => {
			calls++
			return "ok"
		})
		const b = await runOnce(db, key, "returns", async () => {
			calls++
			return "ok"
		})
		expect(calls).toBe(1)
		expect(a.deduped).toBe(false)
		expect(b.deduped).toBe(true)
	})

	// Review finding E: the catch used to swallow ANY P2002 raised anywhere
	// inside `fn` and report it as `deduped: true` — a false "success" for an
	// operation that actually failed. Only the KEY insert's conflict is a dedup.
	it("propagates a real P2002 raised by fn instead of reporting a false dedup", async () => {
		const key = runToken("idem-real")
		keys.push(key)
		// A genuine unique-constraint violation from inside the wrapped work:
		// insert the SAME (different) idempotency key row twice in one fn.
		const collidingKey = runToken("idem-collide")
		keys.push(collidingKey)
		const run = () =>
			runOnce(db, key, "test", async (tx) => {
				await tx.idempotencyKey.create({
					data: { key: collidingKey, scope: "inner" },
				})
				await tx.idempotencyKey.create({
					data: { key: collidingKey, scope: "inner" }, // P2002 from fn
				})
				return "unreachable"
			})
		await expect(run()).rejects.toMatchObject({ code: "P2002" })
		// …and nothing was committed, so the outer key is free to be retried.
		expect(await db.idempotencyKey.findUnique({ where: { key } })).toBeNull()
	})
})

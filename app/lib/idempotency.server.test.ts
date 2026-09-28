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
})

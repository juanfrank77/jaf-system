import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"
import { ensureJobNumber, jobNumberOf } from "./job-number.server"

const { track, cleanup } = makeTracker()

describe("job numbers", () => {
	afterAll(cleanup)

	it("formats the M-number", () => {
		expect(jobNumberOf(3545)).toBe("M-3545")
		expect(jobNumberOf(null)).toBeNull()
	})

	it("gives each Aviso the next number, once, and keeps it", async () => {
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const make = async () =>
			track(
				"jafInvoice",
				await seedFinanceableInvoice({
					status: "CLARO_UPLOADED",
					supervisorId: supervisor.id,
				}),
			)
		const [a, b] = [await make(), await make()]
		const first = await ensureJobNumber(a.id)
		expect(await ensureJobNumber(a.id)).toBe(first)
		const second = await ensureJobNumber(b.id)
		expect(second).toBeGreaterThan(first)
		const stored = await db.jafInvoice.findUniqueOrThrow({
			where: { id: a.id },
		})
		expect(stored.jobSeq).toBe(first)
	})

	it("hands two accepts at once two different numbers", async () => {
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const docs = await Promise.all(
			[0, 1, 2].map(async () =>
				track(
					"jafInvoice",
					await seedFinanceableInvoice({
						status: "CLARO_UPLOADED",
						supervisorId: supervisor.id,
					}),
				),
			),
		)
		const numbers = await Promise.all(docs.map((d) => ensureJobNumber(d.id)))
		expect(new Set(numbers).size).toBe(3)
	})
})

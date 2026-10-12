import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"
import { carmenOpenSummary, stageWhere } from "./finance-stages.server"

const t = makeTracker()
afterAll(() => t.cleanup())

async function job(data: {
	sent?: boolean
	verified?: boolean
	funded?: boolean
}) {
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const inv = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			supervisorId: sup.id,
			pbccRequestSentAt: data.sent ? new Date() : null,
		}),
	)
	await db.jafInvoice.update({
		where: { id: inv.id },
		data: {
			financeVerifiedAt: data.verified ? new Date() : null,
			advanceReceivedAt: data.funded ? new Date() : null,
		},
	})
	return inv.id
}

async function stagesOf(id: string) {
	const out: string[] = []
	for (const s of ["PACKETS", "LC_REQUEST", "LC_FUNDED", "LISTS"] as const) {
		const n = await db.jafInvoice.count({
			where: { AND: [{ id }, stageWhere(s)] },
		})
		if (n) out.push(s)
	}
	return out
}

describe("stageWhere", () => {
	it("puts every Arm A job in exactly one stage", async () => {
		const packets = await job({})
		const request = await job({ verified: true })
		const funded = await job({ sent: true, verified: true })
		const lists = await job({ sent: true, verified: true, funded: true })
		expect(await stagesOf(packets)).toEqual(["PACKETS"])
		expect(await stagesOf(request)).toEqual(["LC_REQUEST"])
		expect(await stagesOf(funded)).toEqual(["LC_FUNDED"])
		expect(await stagesOf(lists)).toEqual(["LISTS"])
	})

	it("treats a packet sent by hand without verification as LC_FUNDED, never two stages", async () => {
		const id = await job({ sent: true })
		expect(await stagesOf(id)).toEqual(["LC_FUNDED"])
	})

	it("drops a job already on a payroll run from every list stage", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: { label: "stage test", generatedById: finance.id },
			}),
		)
		const id = await job({ sent: true, verified: true, funded: true })
		await db.jafInvoice.update({
			where: { id },
			data: { payrollRunId: run.id },
		})
		expect(await stagesOf(id)).toEqual([])
	})
})

describe("carmenOpenSummary overdue cutoff", () => {
	it("matches the pages: overdue once floor(age in days) > 14", async () => {
		const now = new Date()
		const day = 86_400_000
		const fin = t.track("user", await seedUser({ role: "FINANCE" }))
		const before = await carmenOpenSummary(now)
		t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: {
					label: "age 14.5d",
					generatedById: fin.id,
					generatedAt: new Date(now.getTime() - 14.5 * day),
				},
			}),
		)
		const mid = await carmenOpenSummary(now)
		expect(mid.overdueRuns - before.overdueRuns).toBe(0)
		t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: {
					label: "age 15.5d",
					generatedById: fin.id,
					generatedAt: new Date(now.getTime() - 15.5 * day),
				},
			}),
		)
		const after = await carmenOpenSummary(now)
		expect(after.overdueRuns - mid.overdueRuns).toBe(1)
	})
})

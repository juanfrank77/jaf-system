import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("Arm A schema", () => {
	it("creates a ContractorAccount with defaults", async () => {
		const account = t.track(
			"contractorAccount",
			await db.contractorAccount.create({
				data: { code: runToken("ACC"), label: "Test Contractor" },
			}),
		)
		expect(account.sharePercent.toString()).toBe("0.65")
		expect(account.isPlaceholder).toBe(true)
		expect(account.active).toBe(true)
	})

	it("creates a PayrollRun and links a JafInvoice to it, freezing Arm A fields", async () => {
		const generatedBy = t.track("user", await seedUser({ role: "FINANCE" }))
		const supervisor = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const account = t.track(
			"contractorAccount",
			await db.contractorAccount.create({
				data: { code: runToken("ACC"), label: "Test Contractor" },
			}),
		)
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: { label: "Run test", generatedById: generatedBy.id },
			}),
		)
		expect(run.paidAt).toBeNull()
		expect(run.reversedAt).toBeNull()
		expect(run.confirmedByFallback).toBe(false)

		const invoice = t.track(
			"jafInvoice",
			await db.jafInvoice.create({
				data: {
					controlNumber: runToken("JAF"),
					status: "SUPERVISOR_APPROVED",
					jobType: "INSTALL",
					jobAddressEstimated: "123 Test St",
					estimatedMaterials: [],
					assignedCrewIds: [],
					supervisorId: supervisor.id,
					contractorAccountId: account.id,
					payrollRunId: run.id,
					grossPayable: 100,
					retentionAmount: 10,
					netPayable: 90,
					contractorShareLines: [{ serviceCodeId: "x", gross: 100 }],
				},
			}),
		)

		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { invoices: true },
		})
		expect(reloaded.invoices.map((i) => i.id)).toEqual([invoice.id])

		const reloadedInvoice = await db.jafInvoice.findUniqueOrThrow({
			where: { id: invoice.id },
			include: { contractorAccount: true, payrollRun: true },
		})
		expect(reloadedInvoice.contractorAccount?.id).toBe(account.id)
		expect(reloadedInvoice.payrollRun?.id).toBe(run.id)
		expect(reloadedInvoice.netPayable?.toString()).toBe("90")
	})
})

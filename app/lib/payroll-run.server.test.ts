import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	buildJournalBlocks,
	closePayrollRun,
	generateRun,
} from "~/lib/payroll-run.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("generateRun", () => {
	it("sweeps every Arm-A-open invoice into a new run, resolving and freezing its contractor account + payment", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: [
					{
						serviceCodeId: "sc1",
						claroCode: "34006301",
						name: "X",
						unit: "EA",
						qty: 2,
						unitPrice: 100,
						lineAmount: 200,
					},
				],
			}),
		)

		const { run, sweptCount } = await generateRun({
			generatedById: finance.id,
			label: "Run test 1",
		})
		t.track("payrollRun", run as { id: string })

		expect(sweptCount).toBe(1)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBe(run.id)
		expect(reloaded.contractorAccountId).toBe(account.id)
		expect(reloaded.grossPayable?.toString()).toBe("200")
		expect(reloaded.netPayable).not.toBeNull()
	})

	it("never sweeps a job already in an open run (idempotent)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)

		const first = await generateRun({ generatedById: finance.id, label: "R1" })
		t.track("payrollRun", first.run as { id: string })
		const second = await generateRun({ generatedById: finance.id, label: "R2" })
		// generateRun always creates a run row even when it sweeps nothing, and
		// that row FKs generatedById -> User, so it must be tracked for cleanup.
		t.track("payrollRun", second.run as { id: string })

		expect(first.sweptCount).toBe(1)
		expect(second.sweptCount).toBe(0)
	})

	it("under true concurrency, a job is swept into exactly one run, not both (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)

		const [a, b] = await Promise.all([
			generateRun({ generatedById: finance.id, label: "Race A" }),
			generateRun({ generatedById: finance.id, label: "Race B" }),
		])
		t.track("payrollRun", a.run as { id: string })
		t.track("payrollRun", b.run as { id: string })

		// Exactly one of the two runs claimed the job — total swept is 1, not 2.
		expect(a.sweptCount + b.sweptCount).toBe(1)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect([a.run.id, b.run.id]).toContain(reloaded.payrollRunId)
	})

	it("excludes a job whose contractorAccountCode does not resolve to any ContractorAccount", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountId: null,
				contractorAccountCode: "NOT-MAPPED",
			}),
		)

		const { run, sweptCount } = await generateRun({
			generatedById: finance.id,
			label: "R-unmapped",
		})
		t.track("payrollRun", run as { id: string })
		expect(sweptCount).toBe(0)
	})

	it("excludes a job that already has a PBCC_ADVANCE payment record (legacy boundary)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const recorder = t.track("user", await seedUser({ role: "FINANCE" }))
		t.track(
			"paymentRecord",
			await db.paymentRecord.create({
				data: {
					jobId: doc.id,
					type: "PBCC_ADVANCE",
					amount: 100,
					date: new Date(),
					recordedById: recorder.id,
				},
			}),
		)

		const { run, sweptCount } = await generateRun({
			generatedById: finance.id,
			label: "R-legacy",
		})
		t.track("payrollRun", run as { id: string })
		expect(sweptCount).toBe(0)
	})
})

describe("closePayrollRun", () => {
	it("stamps payablesClosedAt on every member invoice and marks the run paid", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-close",
		})
		t.track("payrollRun", run as { id: string })

		const { closedCount } = await closePayrollRun({
			runId: run.id,
			paidById: finance.id,
			achDate: new Date("2026-09-12"),
			achRef: "20260912-JAF-015",
			confirmedByFallback: true,
		})
		expect(closedCount).toBe(1)

		const reloadedRun = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloadedRun.paidAt).not.toBeNull()
		expect(reloadedRun.paidAchRef).toBe("20260912-JAF-015")
		expect(reloadedRun.confirmedByFallback).toBe(true)

		const members = await db.jafInvoice.findMany({
			where: { payrollRunId: run.id },
		})
		expect(members.every((m) => m.payablesClosedAt !== null)).toBe(true)
	})

	it("notifies every FINANCE user when a run is closed", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-notify",
		})
		t.track("payrollRun", run as { id: string })

		await closePayrollRun({
			runId: run.id,
			paidById: finance.id,
			achDate: new Date(),
			achRef: "REF",
			confirmedByFallback: true,
		})

		const notifications = await db.notification.findMany({
			where: { userId: finance.id },
		})
		for (const n of notifications) t.track("notification", n)
		expect(notifications.some((n) => n.message.includes(run.label))).toBe(true)
	})
})

describe("buildJournalBlocks", () => {
	it("groups by contractor account and computes a running cumulative Adj. Net across blocks", () => {
		const blocks = buildJournalBlocks([
			{
				id: "i1",
				controlNumber: "JAF-1",
				avisoNumber: "A1",
				grossPayable: 2104.4,
				retentionAmount: 136.79,
				netPayable: 1231.07,
				contractorAccount: {
					id: "acc1",
					code: "009",
					label: "Jesús Martínez",
					winpayEmployeeCode: "E-0231",
					isPlaceholder: true,
				},
			},
			{
				id: "i2",
				controlNumber: "JAF-2",
				avisoNumber: "A2",
				grossPayable: 3061.4,
				retentionAmount: 198.99,
				netPayable: 1790.92,
				contractorAccount: {
					id: "acc2",
					code: "041",
					label: "Dino Castillo",
					winpayEmployeeCode: "E-0187",
					isPlaceholder: true,
				},
			},
		])

		expect(blocks).toHaveLength(2)
		expect(blocks[0].accountCode).toBe("009")
		expect(blocks[0].adjNetRunning).toBeCloseTo(1231.07, 2)
		expect(blocks[1].adjNetRunning).toBeCloseTo(1231.07 + 1790.92, 2)
		expect(blocks[0].rows.map((r) => r.invoiceId)).toEqual(["i1"])
	})

	it("skips an invoice with no resolved contractor account rather than throwing", () => {
		const blocks = buildJournalBlocks([
			{
				id: "i1",
				controlNumber: "JAF-1",
				avisoNumber: null,
				grossPayable: 100,
				retentionAmount: 10,
				netPayable: 55,
				contractorAccount: null,
			},
		])
		expect(blocks).toEqual([])
	})
})

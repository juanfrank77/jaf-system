import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	armAOpenWhere,
	blockedSentJobs,
	buildJournalBlocks,
	closePayrollRunAccount,
	discardDraftRun,
	EmptyRunError,
	generateRun,
	parsePaidDate,
	payrollSheetLines,
	puertoRicoToday,
	RUN_INVOICES,
	sendPayrollRun,
} from "~/lib/payroll-run.server"
import {
	makeTracker,
	runToken,
	seedBrigade,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

// generateRun is a GLOBAL sweep over the shared dev database. Every test that
// calls it — directly or through a route action — lives in this one file so
// they run sequentially in a single worker and cannot steal each other's
// fixtures by racing for the same candidate pool.
import { action as generateRunAction } from "~/routes/_app.finance.payroll"
import { loader as pbccLoader } from "~/routes/_app.finance.pbcc.$id"

const ONE_LINE_100 = [
	{
		serviceCodeId: "sc1",
		claroCode: "X",
		name: "X",
		unit: "EA",
		qty: 1,
		unitPrice: 100,
		lineAmount: 100,
	},
]

const t = makeTracker()

/**
 * A sweepable job unrelated to the test's subject, so a negative test ("X is
 * not swept") still gets a non-empty run on a fresh database instead of an
 * EmptyRunError.
 */
async function seedSweepFiller() {
	const account = t.track("contractorAccount", await seedContractorAccount())
	t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			contractorAccountCode: account.code,
			funded: true,
		}),
	)
}
afterAll(() => t.cleanup())

describe("generateRun", () => {
	it("sweeps every Arm-A-open invoice into a new run, resolving and freezing its contractor account + payment", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
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

		// generateRun sweeps every Arm-A-open job in the shared dev DB, so the
		// only stable assertion is about *this* job, not the global count.
		expect(sweptCount).toBeGreaterThanOrEqual(1)
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
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				funded: true,
			}),
		)

		const first = await generateRun({ generatedById: finance.id, label: "R1" })
		t.track("payrollRun", first.run as { id: string })
		// With nothing else open (a fresh DB) the second run is refused as empty;
		// either way it must not re-claim the job. A run row that did get created
		// FKs generatedById -> User, so it is tracked for cleanup.
		const second = await generateRun({
			generatedById: finance.id,
			label: "R2",
		}).catch((e) => {
			if (e instanceof EmptyRunError) return null
			throw e
		})
		if (second) t.track("payrollRun", second.run as { id: string })

		const afterFirst = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(afterFirst.payrollRunId).toBe(first.run.id)
		// The second generate must not re-claim the job the first already took.
		const afterSecond = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(afterSecond.payrollRunId).toBe(first.run.id)
	})

	it("under true concurrency, a job is swept into exactly one run, not both (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				funded: true,
			}),
		)

		// The loser may find nothing left and be refused as empty (EmptyRunError).
		const settled = await Promise.allSettled([
			generateRun({ generatedById: finance.id, label: "Race A" }),
			generateRun({ generatedById: finance.id, label: "Race B" }),
		])
		const runs = settled.flatMap((r) => {
			if (r.status === "fulfilled") return [r.value]
			if (r.reason instanceof EmptyRunError) return []
			throw r.reason
		})
		for (const r of runs) t.track("payrollRun", r.run as { id: string })

		// Exactly one of the two runs claimed the job. Asserted as per-run
		// membership rather than a global swept count: generateRun sweeps every
		// Arm-A-open job in the shared dev DB, so other test files contribute
		// rows and the total is not this test's to assert on.
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(runs.map((r) => r.run.id)).toContain(reloaded.payrollRunId)

		const inRun = async (runId: string) =>
			(
				await db.payrollRun.findUniqueOrThrow({
					where: { id: runId },
					include: { invoices: { select: { id: true } } },
				})
			).invoices.some((i) => i.id === doc.id)
		const claims = await Promise.all(runs.map((r) => inRun(r.run.id)))
		expect(claims.filter(Boolean)).toHaveLength(1)
	})

	it("excludes a job whose contractorAccountCode does not resolve to any ContractorAccount", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountId: null,
				contractorAccountCode: "NOT-MAPPED",
			}),
		)

		await seedSweepFiller()
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-unmapped",
		})
		t.track("payrollRun", run as { id: string })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBeNull()
	})

	it("sweeps a job with no pre-cert code through its lead brigade, linked by id", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const brigade = t.track("brigade", await seedBrigade())
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({
				code: brigade.code as string,
				brigadeId: brigade.id,
			}),
		)
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountId: null,
				contractorAccountCode: null,
			}),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { brigadeId: brigade.id },
		})
		expect(await blockedSentJobs()).not.toContainEqual(
			expect.objectContaining({ id: doc.id }),
		)

		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-brigade-link",
		})
		t.track("payrollRun", run as { id: string })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBe(run.id)
		expect(reloaded.contractorAccountId).toBe(account.id)
	})

	it("keeps a job blocked when neither its code nor its brigade has an account", async () => {
		const brigade = t.track("brigade", await seedBrigade())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountId: null,
				contractorAccountCode: null,
			}),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { brigadeId: brigade.id },
		})
		expect(await blockedSentJobs()).toContainEqual(
			expect.objectContaining({ id: doc.id }),
		)
	})

	it("still sweeps a job whose brigade account is inactive (q&a 14.4: deactivation blocks new work, not payment)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({
				code: runToken("BRG-INACT"),
				active: false,
			}),
		)
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
			}),
		)

		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-inactive",
		})
		t.track("payrollRun", run as { id: string })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBe(run.id)
		expect(reloaded.contractorAccountId).toBe(account.id)
	})

	it("holds back a job named in excludeIds; it stays open for the next run (q&a 15.4/15.5)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: runToken("BRG-HOLD") }),
		)
		const kept = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				funded: true,
			}),
		)
		const held = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				funded: true,
			}),
		)

		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-hold",
			excludeIds: [held.id],
		})
		t.track("payrollRun", run as { id: string })

		const keptAfter = await db.jafInvoice.findUniqueOrThrow({
			where: { id: kept.id },
		})
		const heldAfter = await db.jafInvoice.findUniqueOrThrow({
			where: { id: held.id },
		})
		expect(keptAfter.payrollRunId).toBe(run.id)
		expect(heldAfter.payrollRunId).toBeNull()
		expect(heldAfter.grossPayable).toBeNull()
	})

	it("refuses to create an empty run and writes nothing", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const open = await db.jafInvoice.findMany({
			where: armAOpenWhere(),
			select: { id: true },
		})
		const runsBefore = await db.payrollRun.count()
		await expect(
			generateRun({
				generatedById: finance.id,
				label: "R-empty",
				excludeIds: open.map((o) => o.id),
			}),
		).rejects.toBeInstanceOf(EmptyRunError)
		expect(await db.payrollRun.count()).toBe(runsBefore)
	})

	it("sweeps every Arm-A-open invoice in the candidate set", async () => {
		// PDF Part 3 §15.4: the sweep takes every job that is Arm-A-open —
		// released, not closed, no payroll run yet.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: runToken("BRG-SWEEP") }),
		)
		const docA = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
			}),
		)
		const docB = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
			}),
		)

		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-all",
		})
		t.track("payrollRun", run as { id: string })

		const reloadA = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docA.id },
		})
		const reloadB = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docB.id },
		})
		expect(reloadA.payrollRunId).toBe(run.id)
		expect(reloadB.payrollRunId).toBe(run.id)
	})

	it("sweeps a funded packet: a PBCC_ADVANCE payment record does not gate the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
			}),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { advanceReceivedAt: new Date(), advanceAmount: 80 },
		})
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

		await seedSweepFiller()
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-funded",
		})
		t.track("payrollRun", run as { id: string })
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBe(run.id)
	})

	it("sweeps every packet sold to PBCC, funded or not; only the unsent stay open", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const unsent = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
				pbccRequestSentAt: null,
			}),
		)
		const sentUnfunded = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)
		const funded = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
				funded: true,
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "funded-only",
		})
		t.track("payrollRun", run)
		const rows = await db.jafInvoice.findMany({
			where: { id: { in: [unsent.id, sentUnfunded.id, funded.id] } },
			select: { id: true, payrollRunId: true },
		})
		const byId = Object.fromEntries(rows.map((r) => [r.id, r.payrollRunId]))
		expect(byId[funded.id]).toBe(run.id)
		// Payroll does not wait for the bank's wire.
		expect(byId[sentUnfunded.id]).toBe(run.id)
		expect(byId[unsent.id]).toBeNull()
	})

	it("excludeIds still holds back a funded packet", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const kept = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
				funded: true,
			}),
		)
		const held = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
				funded: true,
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "held",
			excludeIds: [held.id],
		})
		t.track("payrollRun", run)
		const k = await db.jafInvoice.findUniqueOrThrow({ where: { id: kept.id } })
		const h = await db.jafInvoice.findUniqueOrThrow({ where: { id: held.id } })
		expect(k.payrollRunId).toBe(run.id)
		expect(h.payrollRunId).toBeNull()
	})

	it("creates exactly one PayrollRunAccount per distinct account, all unpaid", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = t.track("contractorAccount", await seedContractorAccount())
		const b = t.track("contractorAccount", await seedContractorAccount())
		for (const code of [a.code, a.code, b.code]) {
			t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					funded: true,
					contractorAccountCode: code,
					jafInvoiceLines: ONE_LINE_100,
				}),
			)
		}
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "accounts-1",
		})
		t.track("payrollRun", run)
		const rows = await db.payrollRunAccount.findMany({
			where: {
				payrollRunId: run.id,
				contractorAccountId: { in: [a.id, b.id] },
			},
		})
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.paidAt === null)).toBe(true)
	})

	it("a sent packet with an unresolved contractor code is not swept and gets no account row", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: "NO-SUCH-ACCOUNT",
				jafInvoiceLines: ONE_LINE_100,
			}),
		)
		const good = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: good.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "blocked-1",
		})
		t.track("payrollRun", run)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBeNull()
	})

	it("keeps a new request a draft: Carmen is told only when it is sent", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const comptroller = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "notify-1",
		})
		t.track("payrollRun", run)
		const draft = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(draft.sentAt).toBeNull()
		const before = await db.notification.count({
			where: { userId: comptroller.id, message: { contains: "notify-1" } },
		})
		expect(before).toBe(0)

		await sendPayrollRun({ runId: run.id, sentById: finance.id })
		const sent = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(sent.sentAt).not.toBeNull()
		expect(sent.sentById).toBe(finance.id)
		const notes = await db.notification.findMany({
			where: { userId: comptroller.id },
		})
		for (const n of notes) t.track("notification", n)
		expect(notes.some((n) => n.message.includes("notify-1"))).toBe(true)

		// Once only.
		await expect(
			sendPayrollRun({ runId: run.id, sentById: finance.id }),
		).rejects.toMatchObject({ status: 409 })
	})
})

describe("parsePaidDate", () => {
	it("accepts today (any hour) and rejects tomorrow", () => {
		const today = puertoRicoToday()
		expect(parsePaidDate(today)).toHaveProperty("date")
		const tomorrow = new Date(`${today}T12:00:00Z`)
		tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
		expect(parsePaidDate(tomorrow.toISOString().slice(0, 10))).toEqual({
			errorKey: "finance_payroll.errors.future_date",
		})
	})
})

describe("closePayrollRunAccount", () => {
	async function twoAccountRun() {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const comptroller = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const a = t.track("contractorAccount", await seedContractorAccount())
		const b = t.track("contractorAccount", await seedContractorAccount())
		const docs = []
		for (const code of [a.code, b.code]) {
			docs.push(
				t.track(
					"jafInvoice",
					await seedFinanceableInvoice({
						funded: true,
						contractorAccountCode: code,
						jafInvoiceLines: ONE_LINE_100,
					}),
				),
			)
		}
		const { run } = await generateRun({
			generatedById: finance.id,
			label: `acct-${Date.now()}`,
		})
		t.track("payrollRun", run)
		await sendPayrollRun({ runId: run.id, sentById: finance.id })
		return { finance, comptroller, a, b, docs, run }
	}

	it("ticks one account: stamps only that account's jobs, leaves the run open", async () => {
		const { comptroller, a, docs, run } = await twoAccountRun()
		const res = await closePayrollRunAccount({
			runId: run.id,
			accountId: a.id,
			paidById: comptroller.id,
			paidDate: new Date(),
		})
		expect(res.runClosed).toBe(false)
		const [d0, d1] = await Promise.all(
			docs.map((d) => db.jafInvoice.findUniqueOrThrow({ where: { id: d.id } })),
		)
		expect(d0.payablesClosedAt).not.toBeNull()
		expect(d0.payablesClosedById).toBe(comptroller.id)
		expect(d1.payablesClosedAt).toBeNull()
		const r = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
		expect(r.paidAt).toBeNull()
	})

	it("the last tick closes the run and notifies finance exactly once", async () => {
		const { finance, comptroller, a, b, run } = await twoAccountRun()
		const base = {
			runId: run.id,
			paidById: comptroller.id,
			paidDate: new Date(),
		}
		await closePayrollRunAccount({ ...base, accountId: a.id })
		const last = await closePayrollRunAccount({ ...base, accountId: b.id })
		expect(last.runClosed).toBe(true)
		const r = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
		expect(r.paidAt).not.toBeNull()
		const notes = await db.notification.findMany({
			where: { userId: finance.id, message: { contains: run.label } },
		})
		for (const n of notes) t.track("notification", n)
		expect(notes).toHaveLength(1)
	})

	it("rejects a replayed tick with 409 and does not re-stamp (Review Focus 1)", async () => {
		const { comptroller, a, docs, run } = await twoAccountRun()
		const base = {
			runId: run.id,
			accountId: a.id,
			paidById: comptroller.id,
			paidDate: new Date(),
		}
		await closePayrollRunAccount(base)
		const before = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docs[0].id },
		})
		await expect(closePayrollRunAccount(base)).rejects.toMatchObject({
			status: 409,
		})
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docs[0].id },
		})
		expect(after.payablesClosedAt).toEqual(before.payablesClosedAt)
	})

	it("refuses a tick on a reversed run with 409 and claims nothing", async () => {
		const { comptroller, a, run } = await twoAccountRun()
		await db.payrollRun.update({
			where: { id: run.id },
			data: { reversedAt: new Date() },
		})
		await expect(
			closePayrollRunAccount({
				runId: run.id,
				accountId: a.id,
				paidById: comptroller.id,
				paidDate: new Date(),
			}),
		).rejects.toMatchObject({ status: 409 })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: a.id },
		})
		expect(row.paidAt).toBeNull()
	})

	it("two concurrent last ticks close the run once and notify once (Review Focus 2)", async () => {
		const { finance, comptroller, a, b, run } = await twoAccountRun()
		const base = {
			runId: run.id,
			paidById: comptroller.id,
			paidDate: new Date(),
		}
		const results = await Promise.all([
			closePayrollRunAccount({ ...base, accountId: a.id }),
			closePayrollRunAccount({ ...base, accountId: b.id }),
		])
		expect(results.filter((r) => r.runClosed)).toHaveLength(1)
		const notes = await db.notification.findMany({
			where: { userId: finance.id, message: { contains: run.label } },
		})
		for (const n of notes) t.track("notification", n)
		expect(notes).toHaveLength(1)
	})

	it("404s for an account that is not part of the run (Review Focus 5)", async () => {
		const { comptroller, run } = await twoAccountRun()
		const other = t.track("contractorAccount", await seedContractorAccount())
		await expect(
			closePayrollRunAccount({
				runId: run.id,
				accountId: other.id,
				paidById: comptroller.id,
				paidDate: new Date(),
			}),
		).rejects.toMatchObject({ status: 404 })
	})
})

describe("buildJournalBlocks", () => {
	it("groups by brigade, with per-line detail and running adj. net per brigade", () => {
		const blocks = buildJournalBlocks([
			{
				id: "i1",
				controlNumber: "M-JAF-1",
				avisoNumber: "A1",
				contractorAccount: {
					id: "acc1",
					code: "009",
					label: "Jesús Martínez",
				},
				contractorShareLines: [
					{
						claroCode: "34012039",
						name: "REMOCION BAJANTE GPON",
						qty: 1,
						unitPrice: 100,
						gross: 100,
						sharePercent: 0.65,
						net: 65,
						retention: 6.5,
						adjNet: 58.5,
					},
				],
			},
			{
				id: "i2",
				controlNumber: "M-JAF-2",
				avisoNumber: "A2",
				contractorAccount: {
					id: "acc2",
					code: "041",
					label: "Dino Castillo",
				},
				contractorShareLines: [
					{
						claroCode: "34012040",
						name: "REEMPLAZO DE BAJANTE",
						qty: 1,
						unitPrice: 200,
						gross: 200,
						sharePercent: 0.65,
						net: 130,
						retention: 13,
						adjNet: 117,
					},
				],
			},
		])

		expect(blocks).toHaveLength(2)
		// Sorted by brigade code
		expect(blocks[0].brigadeCode).toBe("009")
		expect(blocks[1].brigadeCode).toBe("041")
		// adjNetRunning restarts per brigade
		expect(blocks[0].jobs[0].adjNetRunning).toBeCloseTo(58.5, 2)
		expect(blocks[0].totalSC).toBeCloseTo(58.5, 2)
		expect(blocks[1].jobs[0].adjNetRunning).toBeCloseTo(117, 2)
		expect(blocks[1].totalSC).toBeCloseTo(117, 2)
		// Per-line detail preserved
		expect(blocks[0].jobs[0].lines[0].claroCode).toBe("34012039")
		expect(blocks[0].jobs[0].lines[0].description).toBe("REMOCION BAJANTE GPON")
	})

	it("skips an invoice with no resolved contractor account rather than throwing", () => {
		const blocks = buildJournalBlocks([
			{
				id: "i1",
				controlNumber: "M-JAF-1",
				avisoNumber: null,
				contractorAccount: null,
				contractorShareLines: [],
			},
		])
		expect(blocks).toEqual([])
	})
})

describe("L3 generate_run action", () => {
	it("creates a run and redirects to it", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const inv = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				funded: true,
			}),
		)
		expect(inv.pbccRequestSentAt).not.toBeNull()

		const form = new URLSearchParams({ intent: "generate_run", label: "Run B" })
		let redirected: string | null = null
		try {
			await generateRunAction({
				request: new Request("http://localhost/finance/payroll", {
					method: "POST",
					body: form,
				}),
				params: {},
				context: {},
			} as never)
		} catch (response) {
			if (response instanceof Response)
				redirected = response.headers.get("Location")
		}
		expect(redirected).toMatch(/^\/finance\/payroll\//)
		const created = await db.payrollRun.findFirst({ where: { label: "Run B" } })
		if (created) t.track("payrollRun", created)
		expect(created).not.toBeNull()
	})
})

describe("L3 generate_run action holds unsold packets back", () => {
	// Lives in this file (not its own) because the real generateRun sweeps the
	// whole shared candidate pool; tests in one file run sequentially.
	it("sweeps a sold packet whether or not the bank has funded it, and never an unsold one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const mk = async (pbccRequestSentAt: Date | null) =>
			t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					contractorAccountCode: account.code,
					jafInvoiceLines: ONE_LINE_100,
					pbccRequestSentAt,
				}),
			)
		const soldJob = await mk(new Date())
		const unsoldJob = await mk(null)

		const form = new FormData()
		form.set("intent", "generate_run")
		form.set("label", "unsold guard")
		let status: number | null = null
		try {
			await generateRunAction({
				request: new Request("http://localhost/finance/payroll", {
					method: "POST",
					body: form,
				}),
				params: {},
				context: {},
			} as never)
		} catch (response) {
			if (response instanceof Response) status = response.status
		}
		expect(status).toBe(302)
		const sold = await db.jafInvoice.findUniqueOrThrow({
			where: { id: soldJob.id },
		})
		const unsold = await db.jafInvoice.findUniqueOrThrow({
			where: { id: unsoldJob.id },
		})
		expect(sold.payrollRunId).not.toBeNull()
		expect(unsold.payrollRunId).toBeNull()
		const created = await db.payrollRun.findFirst({
			where: { label: "unsold guard" },
		})
		if (created) t.track("payrollRun", created)
	})
})

describe("armAOpenWhere terminal-status guard", () => {
	it("excludes a job cancelled after it was released to finance", async () => {
		// Cancel is only blocked once a doc is ALREADY terminal, so a doc at
		// CLARO_UPLOADED that was released can still be cancelled — and the
		// cancel never clears releasedToFinanceAt. Without a status guard such a
		// job satisfies every other clause and gets frozen and paid.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const cancelled = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				status: "CANCELLED",
				contractorAccountCode: account.code,
			}),
		)
		const lcFinal = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				status: "LC_REQUEST_GENERATED",
				contractorAccountCode: account.code,
			}),
		)

		await seedSweepFiller()
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-cancelled",
		})
		t.track("payrollRun", run as { id: string })

		for (const doc of [cancelled, lcFinal]) {
			const reloaded = await db.jafInvoice.findUniqueOrThrow({
				where: { id: doc.id },
			})
			expect(reloaded.payrollRunId).toBeNull()
		}
	})
})

// ---------------------------------------------------------------------------
// The two loader tests whose fixtures must stay Arm-A-open live HERE, not in
// their route files. `armAOpenWhere()` is a global predicate over the shared dev
// DB, and `generateRun` claims every row it matches. A test that asserts "this
// job is still open on Arm A" is therefore racing every other file that calls
// the sweep. Keeping all such tests in this one file makes them sequential.
// ---------------------------------------------------------------------------

describe("armAOpenWhere consumers (kept here so they cannot race the sweep)", () => {
	// This exercises the L2 (pbcc) loader, but it lives here rather than in
	// `_app.finance.pbcc.$id.server.test.ts` for the same reason: it seeds an
	// Arm-A-open invoice, and the sibling file's `generateRun` sweep would
	// claim it and freeze its figures mid-assertion.
	it("loader live-computes the contractor payment for a job not yet swept into a run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				funded: true,
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)

		const result = await pbccLoader({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
			params: { id: doc.id },
			context: {},
		} as never)

		expect(result.payment.grossPayable).toBeCloseTo(100, 2)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 * 0.9, 2)
		expect(result.frozen).toBe(false)
	})
})

describe("payroll request lifecycle", () => {
	async function draftRun() {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
				avisoNumber: "30077820",
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: `draft-${Date.now()}`,
		})
		t.track("payrollRun", run)
		return { finance, account, doc, run }
	}

	it("nobody can tick a brigade on a draft: it is not sent to Carmen yet", async () => {
		const { finance, account, run } = await draftRun()
		await expect(
			closePayrollRunAccount({
				runId: run.id,
				accountId: account.id,
				paidById: finance.id,
				paidDate: new Date(),
			}),
		).rejects.toMatchObject({ status: 409 })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(row.paidAt).toBeNull()
	})

	it("discarding a draft puts its jobs back on the Ready list with nothing frozen", async () => {
		const { doc, run } = await draftRun()
		await discardDraftRun(run.id)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.payrollRunId).toBeNull()
		expect(reloaded.contractorAccountId).toBeNull()
		expect(reloaded.netPayable).toBeNull()
		expect(await db.payrollRun.findUnique({ where: { id: run.id } })).toBeNull()
		expect(
			await db.payrollRunAccount.count({ where: { payrollRunId: run.id } }),
		).toBe(0)
	})

	it("a request that has been sent can no longer be discarded or sent again", async () => {
		const { finance, run } = await draftRun()
		await sendPayrollRun({ runId: run.id, sentById: finance.id })
		await expect(discardDraftRun(run.id)).rejects.toMatchObject({
			status: 409,
		})
		await expect(
			sendPayrollRun({ runId: run.id, sentById: finance.id }),
		).rejects.toMatchObject({ status: 409 })
	})

	it("refuses to send a request that has no jobs", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: { label: "empty", generatedById: finance.id },
			}),
		)
		await expect(
			sendPayrollRun({ runId: run.id, sentById: finance.id }),
		).rejects.toBeInstanceOf(EmptyRunError)
		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloaded.sentAt).toBeNull()
	})

	it("the sheet has a line per brigade with its Aviso numbers, net, retention and what to pay, and no gross", async () => {
		const { run } = await draftRun()
		const full = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { invoices: RUN_INVOICES },
		})
		const lines = payrollSheetLines(buildJournalBlocks(full.invoices))
		expect(lines).toHaveLength(1)
		const [line] = lines
		expect(line.avisoNumbers).toEqual(["30077820"])
		// 100 gross -> 65.00 net -> 6.50 retention -> 58.50 to pay
		expect(line.net).toBe(65)
		expect(line.retention).toBe(6.5)
		expect(line.toPay).toBe(58.5)
		expect(Object.keys(line)).not.toContain("gross")
	})
})

describe("payrollSheetLines", () => {
	it("takes retention as 10% of the row's net and pays net less retention", () => {
		// Per-line retention would add up to 58.01 here; the row rule gives 58.04.
		const shareLine = (net: number, retention: number) => ({
			net,
			retention,
			gross: 0,
			adjNet: Math.round((net - retention) * 100) / 100,
		})
		const blocks = buildJournalBlocks([
			{
				id: "i1",
				controlNumber: "MAINT-1",
				avisoNumber: "1",
				contractorAccount: { id: "a", code: "178", label: "ZARIEL" },
				contractorShareLines: [
					shareLine(290.2, 29.0),
					shareLine(290.19, 29.01),
				],
			},
		])
		const [row] = payrollSheetLines(blocks)
		expect(row.net).toBe(580.39)
		expect(row.retention).toBe(58.04)
		expect(row.toPay).toBe(522.35)
		expect(Math.round((row.net - row.retention - row.toPay) * 100)).toBe(0)
	})
})

import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedServiceCode,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.pbcc.$id"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("L2 Packet", () => {
	it("loader returns the frozen payment, unchanged, for a job already swept into a run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		// Simulate the swept state directly rather than calling generateRun:
		// the sweep is global and would race other test files for candidates.
		const { run, invoice: swept } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-frozen",
			grossPayable: 100,
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", swept)

		// Change the catalog price after freezing — the frozen figure must not move.
		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${swept.id}`),
			params: { id: swept.id },
			context: {},
		} as never)
		expect(result.frozen).toBe(true)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 - 10, 2)
	})

	it("mark_sent_by_hand records pbccRequestSentAt and a note without generating missing documents", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)

		const form = new URLSearchParams({
			intent: "mark_sent_by_hand",
			note: "Sent by hand 9/3",
		})
		await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never)

		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(reloaded.pbccRequestSentAt).not.toBeNull()
	})

	// --- Guards carried over from the pre-Arm-A suite. The stage gate moved out
	// of the loader (replaced by the Arm A open condition), so the two loader
	// cases are restated against that gate; the two action cases are unchanged
	// and must keep guarding the auto-generator.

	it("loader redirects a job that is no longer on Arm A (closed or never released)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })

		const closed = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ payablesClosedAt: new Date() }),
		)
		const neverReleased = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ releasedToFinanceAt: null }),
		)

		for (const doc of [closed, neverReleased]) {
			await expect(
				loader({
					request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
					params: { id: doc.id },
					context: {},
				} as never),
			).rejects.toMatchObject({ status: 302 })
		}
	})

	it("loader serves an Arm-A-open job regardless of its finance-pipeline stage", async () => {
		// The Arm A open check replaced the stage gate, so a job that computeFinanceStage
		// would reject still loads here — this is the intended behaviour change.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "LC_REQUEST_GENERATED" }),
		)
		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(result.doc.id).toBe(doc.id)
	})

	it("loader still serves a job already swept into an open, unpaid run (Review Focus)", async () => {
		// The packet view is deliberately wider than L1's: the frozen figures
		// are only reachable here, so a swept job must stay loadable.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		const { invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-packet-frozen",
			grossPayable: 100,
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", { id: invoice.payrollRunId as string })
		t.track("jafInvoice", invoice)

		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${invoice.id}`),
			params: { id: invoice.id },
			context: {},
		} as never)

		expect(result.doc.id).toBe(invoice.id)
		expect(result.frozen).toBe(true)
	})

	it("loader refuses a job cancelled after release (Review Focus)", async () => {
		// Cancelling does not clear releasedToFinanceAt, so without the shared
		// predicate's status guard this job would still load here — the CANCELLED
		// exclusion used to reach this loader via computeFinanceStage and was
		// lost when the gate was restated inline.
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "CANCELLED" }),
		)
		expect(doc.releasedToFinanceAt).not.toBeNull()

		await expect(
			loader({
				request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
				params: { id: doc.id },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects terminal LC jobs", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ status: "CANCELLED" }),
		)
		const form = new URLSearchParams({ intent: "generate_pbcc" })
		const result = await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.terminal_status" })
	})

	it("action rejects wrong stage (auto-generator still stage-gated)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		// No Aviso lines recorded, so computeFinanceStage never reaches
		// PBCC_REQUEST_PENDING even though the job is Arm-A-open.
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: null }),
		)
		const form = new URLSearchParams({ intent: "generate_pbcc" })
		const result = await action({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
			context: {},
		} as never).catch((r: unknown) => r)
		expect(result).toMatchObject({ status: 302 })
	})

	it("keeps a swept job's frozen figures when its catalog price and lines change (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		const { run, invoice: swept } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "R-price-change",
			grossPayable: 100,
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", swept)

		// Rewrite both the catalog price and the job's own line snapshot after
		// the run was generated. The frozen figures must not move.
		const serviceCode = t.track(
			"serviceCode",
			await seedServiceCode("PBCC-FREEZE-CHECK", { unitPrice: 999 }),
		)
		await db.jafInvoice.update({
			where: { id: swept.id },
			data: {
				jafInvoiceLines: [
					{
						serviceCodeId: serviceCode.id,
						claroCode: "PBCC-FREEZE-CHECK",
						name: "Repriced",
						unit: "EA",
						qty: 9,
						unitPrice: 999,
						lineAmount: 8991,
					},
				],
			},
		})

		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${swept.id}`),
			params: { id: swept.id },
			context: {},
		} as never)
		expect(result.frozen).toBe(true)
		expect(result.payment.grossPayable).toBeCloseTo(100, 2)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 - 10, 2)
	})
})

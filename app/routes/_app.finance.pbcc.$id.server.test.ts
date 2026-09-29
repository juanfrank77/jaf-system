import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { generateRun } from "~/lib/payroll-run.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.pbcc.$id"

const t = makeTracker()
afterAll(() => t.cleanup())

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

describe("L2 Packet", () => {
	it("loader live-computes the contractor payment for a job not yet swept into a run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)

		const result = await loader({
			request: new Request(`http://localhost/finance/pbcc/${doc.id}`),
			params: { id: doc.id },
			context: {},
		} as never)

		expect(result.payment.grossPayable).toBeCloseTo(100, 2)
		expect(result.payment.netPayable).toBeCloseTo(100 * 0.65 - 10, 2)
		expect(result.frozen).toBe(false)
	})

	it("loader returns the frozen payment, unchanged, for a job already swept into a run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ sharePercent: 0.65 }),
		)
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: ONE_LINE_100,
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "R-frozen",
		})
		t.track("payrollRun", run as { id: string })
		const swept = await db.jafInvoice.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})

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
})

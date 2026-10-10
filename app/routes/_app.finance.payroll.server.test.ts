import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.payroll"

const t = makeTracker()
afterAll(() => t.cleanup())

const originalFallback = process.env.PAYROLL_FALLBACK_ENABLED
afterEach(() => {
	if (originalFallback === undefined)
		delete process.env.PAYROLL_FALLBACK_ENABLED
	else process.env.PAYROLL_FALLBACK_ENABLED = originalFallback
})

async function callLoader() {
	return loader({
		request: new Request("http://localhost/finance/payroll"),
		params: {},
		context: {},
	} as never)
}

describe("L3 payroll list", () => {
	it("loader lists open (unpaid, unreversed) runs oldest first", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: { label: "Run A", generatedById: finance.id },
			}),
		)

		const result = await loader({
			request: new Request("http://localhost/finance/payroll"),
			params: {},
			context: {},
		} as never)
		expect(result.openRuns.map((r: { id: string }) => r.id)).toContain(run.id)
	})

	// The `generate_run` action calls generateRun, which sweeps EVERY Arm-A-open
	// job in the shared dev DB. Running it in this file in parallel with
	// app/lib/payroll-run.server.test.ts makes the two race for the same global
	// candidate pool and steal each other's fixtures, so it is asserted there —
	// in the same file as every other generateRun caller, where those tests run
	// sequentially.

	it("counts sent packets as ready, and only the funded ones as funded", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const before = await callLoader()

		const mk = async (
			over: Parameters<typeof seedFinanceableInvoice>[0],
			funded = false,
		) => {
			const inv = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					contractorAccountCode: account.code,
					...over,
				}),
			)
			if (funded)
				await db.jafInvoice.update({
					where: { id: inv.id },
					data: { advanceReceivedAt: new Date(), advanceAmount: 10 },
				})
		}
		await mk({}) // sent, unfunded
		await mk({}, true) // sent, funded
		await mk({ pbccRequestSentAt: null }, true) // unsent: counts nowhere

		const after = await callLoader()
		expect(after.sentReady - before.sentReady).toBe(2)
		expect(after.fundedReady - before.fundedReady).toBe(1)
		expect(after.openJobCount).toBe(after.sentReady)
	})

	it("blocked lists a sent job with an unmapped code, not unsent or inactive-account ones", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const inactive = t.track(
			"contractorAccount",
			await seedContractorAccount({ active: false }),
		)
		const unmapped = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: runToken("NOPE"),
			}),
		)
		const unsent = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: runToken("NOPE"),
				pbccRequestSentAt: null,
			}),
		)
		const onInactive = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: inactive.code }),
		)

		const { blocked } = await callLoader()
		const ids = blocked.map((b: { id: string }) => b.id)
		expect(ids).toContain(unmapped.id)
		expect(ids).not.toContain(unsent.id)
		expect(ids).not.toContain(onInactive.id)
	})

	it("fallbackEnabled follows PAYROLL_FALLBACK_ENABLED", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		process.env.PAYROLL_FALLBACK_ENABLED = "false"
		expect((await callLoader()).fallbackEnabled).toBe(false)
		delete process.env.PAYROLL_FALLBACK_ENABLED
		expect((await callLoader()).fallbackEnabled).toBe(true)
	})
})

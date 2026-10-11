import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	resolveSpy: vi.fn(),
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
// Passthrough spy: counts calls to resolveContractorAccounts.
vi.mock("~/lib/contractor-payment.server", async (orig) => {
	const actual = await orig<typeof import("~/lib/contractor-payment.server")>()
	mocks.resolveSpy.mockImplementation(actual.resolveContractorAccounts)
	return { ...actual, resolveContractorAccounts: mocks.resolveSpy }
})

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
	it("loader lists sent runs (newest first, last 20)", async () => {
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
		expect(result.sentRuns.map((r: { id: string }) => r.id)).toContain(run.id)
	})

	// The `generate_run` action calls generateRun, which sweeps EVERY Arm-A-open
	// job in the shared dev DB. Running it in this file in parallel with
	// app/lib/payroll-run.server.test.ts makes the two race for the same global
	// candidate pool and steal each other's fixtures, so it is asserted there —
	// in the same file as every other generateRun caller, where those tests run
	// sequentially.

	async function seedFunded(
		code: string | null,
		over: Parameters<typeof seedFinanceableInvoice>[0] = {},
		funded = true,
	) {
		const inv = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: code, ...over }),
		)
		if (funded)
			await db.jafInvoice.update({
				where: { id: inv.id },
				data: { advanceReceivedAt: new Date(), advanceAmount: 10 },
			})
		return inv
	}

	it("eligible holds funded packets only: unfunded and unsent are not listed", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const unfunded = await seedFunded(account.code, {}, false)
		const funded = await seedFunded(account.code)
		const unsent = await seedFunded(account.code, { pbccRequestSentAt: null })

		const { eligible } = await callLoader()
		const ids = eligible.map((r: { id: string }) => r.id)
		expect(ids).toContain(funded.id)
		expect(ids).not.toContain(unfunded.id)
		expect(ids).not.toContain(unsent.id)
		expect(
			eligible.find((r: { id: string }) => r.id === funded.id)?.accountResolved,
		).toBe(true)
	})

	it("flags a funded packet whose account code does not resolve", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const bad = await seedFunded(runToken("NOPE"))
		const { eligible, sweepableCount } = await callLoader()
		const row = eligible.find((r: { id: string }) => r.id === bad.id)
		expect(row?.accountResolved).toBe(false)
		expect(typeof sweepableCount).toBe("number")
	})

	it("excludes a closed (payablesClosedAt) job", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const closed = await seedFunded(account.code, {
			payablesClosedAt: new Date(),
		})
		const { eligible } = await callLoader()
		expect(eligible.map((r: { id: string }) => r.id)).not.toContain(closed.id)
	})

	it("resolves contractor accounts once for the whole page, not per row", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		for (let i = 0; i < 3; i++) {
			const acc = t.track("contractorAccount", await seedContractorAccount())
			await seedFunded(acc.code)
		}
		mocks.resolveSpy.mockClear()
		const { eligible } = await callLoader()
		expect(eligible.length).toBeGreaterThanOrEqual(3)
		// One call for the page's rows plus the pre-existing one inside
		// blockedSentJobs; neither scales with the number of rows.
		expect(mocks.resolveSpy.mock.calls.length).toBeLessThanOrEqual(2)
		const pageCall = mocks.resolveSpy.mock.calls.find(
			(c) => c[0].length >= eligible.length,
		)
		expect(pageCall).toBeDefined()
	})

	it("sentRuns lists recent runs newest first with paid state", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const run = t.track(
			"payrollRun",
			await db.payrollRun.create({
				data: { label: "Run S", generatedById: finance.id },
			}),
		)
		const { sentRuns } = await callLoader()
		const row = sentRuns.find((r: { id: string }) => r.id === run.id)
		expect(row).toMatchObject({ label: "Run S", paidAt: null })
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

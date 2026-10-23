import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedSweptInvoice,
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

async function callLoader(tab?: "ready" | "waiting" | "paid") {
	return loader({
		request: new Request(
			`http://localhost/finance/payroll${tab ? `?tab=${tab}` : ""}`,
		),
		params: {},
		context: {},
	} as never)
}

async function financeUser() {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: finance })
	return finance
}

describe("Payroll to Carmen", () => {
	// The `generate_run` action calls generateRun, which sweeps EVERY Arm-A-open
	// job in the shared dev DB. Running it in this file in parallel with
	// app/lib/payroll-run.server.test.ts makes the two race for the same global
	// candidate pool and steal each other's fixtures, so it is asserted there —
	// in the same file as every other generateRun caller, where those tests run
	// sequentially.

	async function seedSold(
		code: string | null,
		over: Parameters<typeof seedFinanceableInvoice>[0] = {},
	) {
		return t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: code, ...over }),
		)
	}

	it("the Ready tab lists every Aviso sold to PBCC, funded or not, and no unsold one", async () => {
		await financeUser()
		const account = t.track("contractorAccount", await seedContractorAccount())
		const sold = await seedSold(account.code)
		const soldFunded = await seedSold(account.code, { funded: true })
		const unsold = await seedSold(account.code, { pbccRequestSentAt: null })

		const { eligible, tab } = await callLoader()
		expect(tab).toBe("ready")
		const ids = eligible.map((r: { id: string }) => r.id)
		expect(ids).toContain(sold.id)
		expect(ids).toContain(soldFunded.id)
		expect(ids).not.toContain(unsold.id)
		expect(
			eligible.find((r: { id: string }) => r.id === sold.id)?.accountResolved,
		).toBe(true)
	})

	it("flags a sold Aviso whose account code does not resolve", async () => {
		await financeUser()
		const account = t.track("contractorAccount", await seedContractorAccount())
		const mapped = await seedSold(account.code)
		const bad = await seedSold(runToken("NOPE"))
		const { eligible, sweepableIds } = await callLoader()
		const row = eligible.find((r: { id: string }) => r.id === bad.id)
		expect(row?.accountResolved).toBe(false)
		expect(sweepableIds).toContain(mapped.id)
		expect(sweepableIds).not.toContain(bad.id)
	})

	it("excludes a closed (payablesClosedAt) job", async () => {
		await financeUser()
		const account = t.track("contractorAccount", await seedContractorAccount())
		const closed = await seedSold(account.code, {
			payablesClosedAt: new Date(),
		})
		const { eligible } = await callLoader()
		expect(eligible.map((r: { id: string }) => r.id)).not.toContain(closed.id)
	})

	it("resolves contractor accounts once for the whole page, not per row", async () => {
		await financeUser()
		for (let i = 0; i < 3; i++) {
			const acc = t.track("contractorAccount", await seedContractorAccount())
			await seedSold(acc.code)
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

	it("blocked lists a sold job with an unmapped code, not unsold or inactive-account ones", async () => {
		await financeUser()
		const inactive = t.track(
			"contractorAccount",
			await seedContractorAccount({ active: false }),
		)
		const unmapped = await seedSold(runToken("NOPE"))
		const unsold = await seedSold(runToken("NOPE"), {
			pbccRequestSentAt: null,
		})
		const onInactive = await seedSold(inactive.code)

		const { blocked } = await callLoader()
		const ids = blocked.map((b: { id: string }) => b.id)
		expect(ids).toContain(unmapped.id)
		expect(ids).not.toContain(unsold.id)
		expect(ids).not.toContain(onInactive.id)
	})

	it("shows a draft on the Ready tab and a sent request only on Waiting", async () => {
		const finance = await financeUser()
		const account = t.track("contractorAccount", await seedContractorAccount())
		const draft = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: runToken("DRAFT"),
			draft: true,
		})
		t.track("payrollRun", draft.run)
		t.track("jafInvoice", draft.invoice)
		const sent = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: runToken("SENT"),
		})
		t.track("payrollRun", sent.run)
		t.track("jafInvoice", sent.invoice)

		const ready = await callLoader("ready")
		const readyIds = ready.drafts.map((r: { id: string }) => r.id)
		expect(readyIds).toContain(draft.run.id)
		expect(readyIds).not.toContain(sent.run.id)

		const waiting = await callLoader("waiting")
		const waitingIds = waiting.requests.map((r: { id: string }) => r.id)
		expect(waitingIds).toContain(sent.run.id)
		expect(waitingIds).not.toContain(draft.run.id)
		const req = waiting.requests.find(
			(r: { id: string }) => r.id === sent.run.id,
		)
		expect(req?.status).toBe("waiting")
		// Rule 6, from Lissette's side too: the JAF price is not in the data.
		expect(JSON.stringify(waiting.requests)).not.toMatch(/gross/i)
	})

	it("the Paid tab lists paid requests and the tab counts follow", async () => {
		const finance = await financeUser()
		const account = t.track("contractorAccount", await seedContractorAccount())
		const seeded = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: runToken("PAID"),
		})
		t.track("payrollRun", seeded.run)
		t.track("jafInvoice", seeded.invoice)
		const before = await callLoader("ready")
		await db.payrollRun.update({
			where: { id: seeded.run.id },
			data: { paidAt: new Date(), paidById: finance.id },
		})
		const paid = await callLoader("paid")
		expect(paid.requests.map((r: { id: string }) => r.id)).toContain(
			seeded.run.id,
		)
		const after = await callLoader("ready")
		expect(after.paidCount).toBe(before.paidCount + 1)
		expect(after.waitingCount).toBe(before.waitingCount - 1)
	})

	it("requires FINANCE or ADMIN", async () => {
		await financeUser()
		mocks.requireRole.mockClear()
		await callLoader()
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})
})

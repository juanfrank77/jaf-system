import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.awaiting-carmen"

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
		request: new Request("http://localhost/finance/awaiting-carmen"),
		params: {},
		context: {},
	} as never)
}

const DAY = 86_400_000

async function seedRun(opts: {
	financeId: string
	daysAgo: number
	paid?: boolean
	accounts: { id: string; paid: boolean }[]
}) {
	const run = t.track(
		"payrollRun",
		await db.payrollRun.create({
			data: {
				label: `Carmen ${Math.random().toString(36).slice(2, 8)}`,
				generatedById: opts.financeId,
				generatedAt: new Date(Date.now() - opts.daysAgo * DAY),
				paidAt: opts.paid ? new Date() : null,
			},
		}),
	)
	for (const a of opts.accounts) {
		await db.payrollRunAccount.create({
			data: {
				payrollRunId: run.id,
				contractorAccountId: a.id,
				paidAt: a.paid ? new Date() : null,
				paidById: a.paid ? opts.financeId : null,
			},
		})
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountId: a.id,
				payrollRunId: run.id,
			}),
		)
	}
	return run
}

describe("Carmen's payment loader", () => {
	it("lists open runs oldest-first with paid and unpaid accounts and an age", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const a = t.track("contractorAccount", await seedContractorAccount())
		const b = t.track("contractorAccount", await seedContractorAccount())
		const older = await seedRun({
			financeId: finance.id,
			daysAgo: 20,
			accounts: [
				{ id: a.id, paid: true },
				{ id: b.id, paid: false },
			],
		})
		const newer = await seedRun({
			financeId: finance.id,
			daysAgo: 2,
			accounts: [{ id: a.id, paid: false }],
		})

		const result = await callLoader()
		const ids = result.runs.map((r: { id: string }) => r.id)
		expect(ids.indexOf(older.id)).toBeGreaterThanOrEqual(0)
		expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id))
		const run = result.runs.find((r: { id: string }) => r.id === older.id)
		expect(run?.ageDays).toBeGreaterThanOrEqual(20)
		expect(run?.overdue).toBe(true)
		expect(
			run?.accounts.map((x: { paidAt: unknown }) => Boolean(x.paidAt)).sort(),
		).toEqual([false, true])
		expect(run?.accounts.every((x: { jobs: number }) => x.jobs === 1)).toBe(
			true,
		)
		const fresh = result.runs.find((r: { id: string }) => r.id === newer.id)
		expect(fresh?.overdue).toBe(false)
	})

	it("omits a fully paid run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const a = t.track("contractorAccount", await seedContractorAccount())
		const closed = await seedRun({
			financeId: finance.id,
			daysAgo: 5,
			paid: true,
			accounts: [{ id: a.id, paid: true }],
		})
		const result = await callLoader()
		expect(result.runs.some((r: { id: string }) => r.id === closed.id)).toBe(
			false,
		)
	})

	it("reports fallbackEnabled from the env flag", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		process.env.PAYROLL_FALLBACK_ENABLED = "false"
		expect((await callLoader()).fallbackEnabled).toBe(false)
		process.env.PAYROLL_FALLBACK_ENABLED = "true"
		expect((await callLoader()).fallbackEnabled).toBe(true)
	})
})

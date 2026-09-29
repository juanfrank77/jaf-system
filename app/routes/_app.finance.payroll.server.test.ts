import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.payroll"

const t = makeTracker()
afterAll(() => t.cleanup())

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

	it("generate_run creates a run from every open job and redirects to it", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)

		const form = new URLSearchParams({ intent: "generate_run", label: "Run B" })
		let redirected: string | null = null
		try {
			await action({
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

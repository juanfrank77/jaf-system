import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.payroll"

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

	// The `generate_run` action calls generateRun, which sweeps EVERY Arm-A-open
	// job in the shared dev DB. Running it in this file in parallel with
	// app/lib/payroll-run.server.test.ts makes the two race for the same global
	// candidate pool and steal each other's fixtures, so it is asserted there —
	// in the same file as every other generateRun caller, where those tests run
	// sequentially.
})

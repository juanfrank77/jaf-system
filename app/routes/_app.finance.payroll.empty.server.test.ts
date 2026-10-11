import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	generateRun: vi.fn(),
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
// generateRun is mocked so this file never sweeps the shared candidate pool
// (the real-sweep action tests live in app/lib/payroll-run.server.test.ts).
vi.mock("~/lib/payroll-run.server", async (orig) => ({
	...(await orig<typeof import("~/lib/payroll-run.server")>()),
	generateRun: mocks.generateRun,
}))

import { EmptyRunError } from "~/lib/payroll-run.server"
import { action } from "./_app.finance.payroll"

describe("generate_run when nothing can be listed", () => {
	it("returns empty_run when generateRun finds no funded packets", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "u1" } })
		mocks.generateRun.mockRejectedValue(new EmptyRunError())
		const form = new FormData()
		form.set("intent", "generate_run")
		const result = await action({
			request: new Request("http://localhost/finance/payroll", {
				method: "POST",
				body: form,
			}),
			params: {},
			context: {},
		} as never)
		expect(result).toEqual({ errorKey: "finance_payroll.errors.empty_run" })
		// The unfunded guard is merged in at submit time.
		expect(mocks.generateRun).toHaveBeenCalledWith(
			expect.objectContaining({ excludeIds: expect.any(Array) }),
		)
	})
})

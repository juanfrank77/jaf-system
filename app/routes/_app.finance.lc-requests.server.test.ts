import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.lc-requests"

const t = makeTracker()
afterAll(() => t.cleanup())

const OLD = new Date("2000-01-01")

describe("step 2 LC request", () => {
	it("lists an accepted unsent job and not an unaccepted one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const accepted = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		await db.jafInvoice.update({
			where: { id: accepted.id },
			data: { financeVerifiedAt: new Date() },
		})
		const unaccepted = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		const result = await loader({
			request: new Request("http://localhost/finance/lc-requests"),
			params: {},
			context: {},
		} as never)
		const ids = result.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(accepted.id)
		expect(ids).not.toContain(unaccepted.id)
	})
})

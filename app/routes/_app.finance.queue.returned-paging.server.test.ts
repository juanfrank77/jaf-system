import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
// Two rows per page, so three returned packets span two pages.
vi.mock("~/lib/finance-stage-paging", () => ({ PAGE_SIZE: 2 }))

import { loader } from "./_app.finance.queue"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("Returned list paging (S4)", () => {
	it("reaches every returned packet across pages", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const made: string[] = []
		for (let i = 0; i < 3; i++) {
			const d = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date(2000, 0, 1 + i),
				}),
			)
			await db.jafInvoice.update({
				where: { id: d.id },
				data: {
					financeSendBackNotes: [
						{
							note: "Fix",
							byUserId: "u",
							createdAt: "2026-10-26T14:00:00.000Z",
						},
					],
				},
			})
			made.push(d.id)
		}
		const page = async (n: number) =>
			(await loader({
				request: new Request(
					`http://localhost/finance/queue?stage=returned&page=${n}`,
				),
				params: {},
				context: {},
			} as never)) as unknown as {
				jobs: { id: string }[]
				pagination: { totalPages: number; totalCount: number }
			}
		const p1 = await page(1)
		const p2 = await page(2)
		expect(p1.pagination.totalPages).toBeGreaterThanOrEqual(2)
		const seen = [...p1.jobs, ...p2.jobs].map((j) => j.id)
		for (const id of made) expect(seen).toContain(id)
	})
})

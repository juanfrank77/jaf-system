import { afterAll, describe, expect, it, vi } from "vitest"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.queue"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("L1 Packets in loader", () => {
	it("lists every Arm-A-open job, including one whose contractor account code doesn't resolve yet, and excludes a closed one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const mapped = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const unmapped = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: "NOT-MAPPED" }),
		)
		const closed = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				payablesClosedAt: new Date(),
			}),
		)

		const result = await loader({
			request: new Request("http://localhost/finance/queue"),
			params: {},
			context: {},
		} as never)

		const ids = result.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(mapped.id)
		expect(ids).toContain(unmapped.id)
		expect(ids).not.toContain(closed.id)
		const unmappedRow = result.jobs.find(
			(j: { id: string }) => j.id === unmapped.id,
		)
		expect(unmappedRow).toBeDefined()
		expect(unmappedRow?.accountResolved).toBe(false)
		const mappedRow = result.jobs.find(
			(j: { id: string }) => j.id === mapped.id,
		)
		expect(mappedRow).toBeDefined()
		expect(mappedRow?.accountResolved).toBe(true)
	})
})

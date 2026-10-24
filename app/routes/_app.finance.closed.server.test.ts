import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedContractorAccount,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.closed"

const t = makeTracker()
afterAll(() => t.cleanup())

const call = (qs = "") =>
	loader({
		request: new Request(`http://localhost/finance/closed${qs}`),
		params: {},
		context: {},
	} as never)

describe("step 4 closed", () => {
	it("lists a paid Aviso with its dates and the days from sold to paid, and not an open one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)
		const open = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
		})
		t.track("payrollRun", open.run)
		t.track("jafInvoice", open.invoice)

		const sold = new Date("2026-10-12T16:00:00Z")
		const paid = new Date("2026-10-23T16:00:00Z")
		const avisoNumber = runToken("AV")
		await db.payrollRunAccount.create({
			data: {
				payrollRunId: run.id,
				contractorAccountId: account.id,
				paidAt: paid,
				paidById: finance.id,
			},
		})
		await db.jafInvoice.update({
			where: { id: invoice.id },
			data: {
				avisoNumber,
				pbccRequestSentAt: sold,
				payablesClosedAt: paid,
			},
		})

		const { rows } = await call(`?search=${avisoNumber}`)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: invoice.id,
			avisoNumber,
			soldToPbccAt: sold.toISOString(),
			brigadePaidAt: paid.toISOString(),
			daysSoldToPaid: 11,
			requestLabel: run.label,
		})
		expect(rows[0].brigade).toContain(account.code)
		const all = await call()
		expect(all.rows.map((r: { id: string }) => r.id)).not.toContain(
			open.invoice.id,
		)
	})
})

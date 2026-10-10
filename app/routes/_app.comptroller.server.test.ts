import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { buildJournalBlocks, RUN_INVOICES } from "~/lib/payroll-run.server"
import {
	makeTracker,
	runToken,
	seedContractorAccount,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader as indexLoader } from "./_app.comptroller"
import { action, loader as runLoader } from "./_app.comptroller.runs.$runId"

const t = makeTracker()
afterAll(() => t.cleanup())

const originalFallback = process.env.PAYROLL_FALLBACK_ENABLED
afterEach(() => {
	if (originalFallback === undefined)
		delete process.env.PAYROLL_FALLBACK_ENABLED
	else process.env.PAYROLL_FALLBACK_ENABLED = originalFallback
	mocks.requireRole.mockReset()
})

/** A run with one invoice + PayrollRunAccount row per entry. */
async function seedRun(count = 1) {
	const comptroller = t.track("user", await seedUser({ role: "COMPTROLLER" }))
	mocks.requireRole.mockResolvedValue({ user: comptroller })
	const accounts = []
	let run: Awaited<ReturnType<typeof seedSweptInvoice>>["run"] | null = null
	for (let i = 0; i < count; i++) {
		const account = t.track("contractorAccount", await seedContractorAccount())
		accounts.push(account)
		if (!run) {
			const seeded = await seedSweptInvoice({
				generatedById: comptroller.id,
				contractorAccountId: account.id,
				runLabel: runToken("CRUN"),
				grossPayable: 1000,
			})
			run = seeded.run
			t.track("payrollRun", seeded.run)
			t.track("jafInvoice", seeded.invoice)
		} else {
			const { invoice, run: extraRun } = await seedSweptInvoice({
				generatedById: comptroller.id,
				contractorAccountId: account.id,
				grossPayable: 500,
			})
			// seedSweptInvoice makes its own run; move the invoice into ours.
			await db.jafInvoice.update({
				where: { id: invoice.id },
				data: { payrollRunId: run.id },
			})
			await db.payrollRun.delete({ where: { id: extraRun.id } })
			t.track("jafInvoice", invoice)
		}
		await db.payrollRunAccount.create({
			data: { payrollRunId: run.id, contractorAccountId: account.id },
		})
	}
	return { comptroller, accounts, run: run as NonNullable<typeof run> }
}

const load = (runId: string) =>
	runLoader({
		request: new Request(`http://localhost/comptroller/runs/${runId}`),
		params: { runId },
		context: {},
	} as never)

function post(runId: string, fields: Record<string, string>) {
	return action({
		request: new Request(`http://localhost/comptroller/runs/${runId}`, {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
		params: { runId },
		context: {},
	} as never)
}

async function status(r: unknown) {
	try {
		await r
		return 200
	} catch (e) {
		if (e instanceof Response) return e.status
		throw e
	}
}

describe("comptroller index loader", () => {
	it("lists an open run (0/2) apart from a paid run, with the from-paper count", async () => {
		const open = await seedRun(2)
		const paid = await seedRun(1)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: paid.run.id },
			data: {
				paidAt: new Date(),
				paidById: paid.comptroller.id,
				confirmedByFallback: true,
			},
		})
		await db.payrollRun.update({
			where: { id: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})

		const result = await indexLoader({
			request: new Request("http://localhost/comptroller"),
			params: {},
			context: {},
		} as never)

		const openRow = result.toPay.find((r) => r.id === open.run.id)
		expect(openRow?.accounts.filter((a) => a.paidAt)).toHaveLength(0)
		expect(openRow?.accounts).toHaveLength(2)
		expect(result.paid.some((r) => r.id === open.run.id)).toBe(false)
		const paidRow = result.paid.find((r) => r.id === paid.run.id)
		expect(paidRow).toBeDefined()
		expect(result.toPay.some((r) => r.id === paid.run.id)).toBe(false)
		expect(paidRow?.accounts.filter((a) => a.confirmedByFallback)).toHaveLength(
			1,
		)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})
})

describe("comptroller run loader", () => {
	it("returns one row per account matching the journal, flagging finance-ticked ones", async () => {
		const { accounts, run, comptroller } = await seedRun(2)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
			data: {
				paidAt: new Date(),
				paidById: comptroller.id,
				confirmedByFallback: true,
			},
		})

		const result = await load(run.id)
		expect(result.accounts).toHaveLength(2)

		const full = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { invoices: RUN_INVOICES },
		})
		const blocks = buildJournalBlocks(full.invoices)
		for (const row of result.accounts) {
			const block = blocks.find((b) => b.brigadeCode === row.code)
			expect(block).toBeDefined()
			expect(row.gross).toBe(block?.gross)
			expect(row.net).toBe(block?.net)
			expect(row.retention).toBe(block?.retention)
			expect(row.toPay).toBe(block?.totalSC)
			expect(row.jobs).toBe(block?.jobs.length)
		}
		const ticked = result.accounts.find((a) => a.accountId === accounts[0].id)
		const open = result.accounts.find((a) => a.accountId === accounts[1].id)
		expect(ticked?.confirmedByFallback).toBe(true)
		expect(ticked?.paidAt).not.toBeNull()
		expect(open?.paidAt).toBeNull()
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})

	it("404s for an unknown run", async () => {
		await seedRun(1)
		expect(await status(load("no-such-run"))).toBe(404)
	})
})

describe("pay_account", () => {
	it("ticks the account as the comptroller even with the fallback switched off", async () => {
		const { accounts, run, comptroller } = await seedRun(1)
		process.env.PAYROLL_FALLBACK_ENABLED = "false"
		const fields = {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: "2026-09-12",
		}
		expect(await post(run.id, fields)).toMatchObject({ ok: true })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
		})
		expect(row.paidAt).not.toBeNull()
		expect(row.paidById).toBe(comptroller.id)
		expect(row.confirmedByFallback).toBe(false)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])

		// A replay (double-click, stale tab) is treated as success, not an error.
		expect(await post(run.id, fields)).toMatchObject({ ok: true })
	})

	it("404s for an account from another run", async () => {
		const { run } = await seedRun(1)
		const other = t.track("contractorAccount", await seedContractorAccount())
		expect(
			await status(
				post(run.id, {
					intent: "pay_account",
					accountId: other.id,
					paidDate: "2026-09-12",
				}),
			),
		).toBe(404)
	})

	it("rejects a future date with an errorKey and stamps nothing", async () => {
		const { accounts, run } = await seedRun(1)
		const result = await post(run.id, {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: "2999-01-01",
		})
		expect(result).toMatchObject({
			errorKey: "finance_payroll.errors.future_date",
		})
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(row.paidAt).toBeNull()
	})

	it("checks the role on the action too", async () => {
		const { run } = await seedRun(1)
		await post(run.id, { intent: "nope" })
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})
})

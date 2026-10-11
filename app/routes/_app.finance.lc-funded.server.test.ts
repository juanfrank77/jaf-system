import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.lc-funded"

const t = makeTracker()
afterAll(() => t.cleanup())

const OLD = new Date("2000-01-01")

async function callLoader() {
	return loader({
		request: new Request("http://localhost/finance/lc-funded"),
		params: {},
		context: {},
	} as never)
}

function fundForm(jobId: string, over: Record<string, string> = {}) {
	const form = new FormData()
	form.set("intent", "mark_funded")
	form.set("jobId", jobId)
	form.set("fundedDate", new Date().toLocaleDateString("en-CA"))
	form.set("fundedAmount", "100.00")
	form.set("fundedRef", "ACH-1")
	for (const [k, v] of Object.entries(over)) form.set(k, v)
	return form
}

async function callAction(form: FormData) {
	return action({
		request: new Request("http://localhost/finance/lc-funded", {
			method: "POST",
			body: form,
		}),
		params: {},
		context: {},
	} as never)
}

async function seedSent() {
	return t.track(
		"jafInvoice",
		await seedFinanceableInvoice({ releasedToFinanceAt: OLD }),
	)
}

describe("step 3 LC funded", () => {
	it("lists a sent unfunded job and not a funded one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const open = await seedSent()
		const funded = await seedSent()
		await db.jafInvoice.update({
			where: { id: funded.id },
			data: { advanceReceivedAt: new Date(), advanceAmount: 10 },
		})
		const result = await callLoader()
		const ids = result.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(open.id)
		expect(ids).not.toContain(funded.id)
		expect(result.defaultAdvance[open.id]).toBeTypeOf("number")
	})

	it("mark_funded sets advanceReceivedAt and drops the job from the list", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const job = await seedSent()
		await callAction(fundForm(job.id))
		const row = await db.jafInvoice.findUniqueOrThrow({
			where: { id: job.id },
		})
		expect(row.advanceReceivedAt).not.toBeNull()
		const ids = (await callLoader()).jobs.map((j: { id: string }) => j.id)
		expect(ids).not.toContain(job.id)
	})

	it("rejects a future funded date", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const job = await seedSent()
		const future = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString(
			"en-CA",
		)
		const result = await callAction(fundForm(job.id, { fundedDate: future }))
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.future_date" })
		const row = await db.jafInvoice.findUniqueOrThrow({
			where: { id: job.id },
		})
		expect(row.advanceReceivedAt).toBeNull()
	})

	it("rejects funding a packet whose request was never sent", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const job = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				releasedToFinanceAt: OLD,
				pbccRequestSentAt: null,
			}),
		)
		const result = await callAction(fundForm(job.id))
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.not_sent" })
		const row = await db.jafInvoice.findUniqueOrThrow({ where: { id: job.id } })
		expect(row.advanceReceivedAt).toBeNull()
	})

	it("rejects funding a packet in a terminal status", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const job = await seedSent()
		await db.jafInvoice.update({
			where: { id: job.id },
			data: { status: "CANCELLED" },
		})
		const result = await callAction(fundForm(job.id))
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.terminal_status" })
		const row = await db.jafInvoice.findUniqueOrThrow({ where: { id: job.id } })
		expect(row.advanceReceivedAt).toBeNull()
	})

	it("a second mark_funded returns a 409 without throwing", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const job = await seedSent()
		await callAction(fundForm(job.id))
		const second = (await callAction(fundForm(job.id))) as {
			type?: string
			data?: unknown
			init?: { status?: number }
		}
		expect(second.init?.status).toBe(409)
		expect(second.data).toEqual({
			errorKey: "finance_pbcc.errors.already_funded",
		})
	})
})

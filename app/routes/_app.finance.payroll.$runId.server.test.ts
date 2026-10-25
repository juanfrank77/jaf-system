import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.payroll.$runId"
import { loader as journalLoader } from "./_app.finance.payroll.$runId.journal"

const t = makeTracker()
afterAll(() => t.cleanup())

async function seed(
	opts: { draft?: boolean; label?: string; code?: string } = {},
) {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: finance })
	const account = t.track(
		"contractorAccount",
		await seedContractorAccount(
			opts.code ? { code: opts.code, label: "Jesús Martínez" } : {},
		),
	)
	const { run, invoice } = await seedSweptInvoice({
		generatedById: finance.id,
		contractorAccountId: account.id,
		runLabel: opts.label ?? "Run detail",
		grossPayable: 100,
		retentionAmount: 100 * 0.65 * 0.1,
		netPayable: 100 * 0.65 * 0.9,
		draft: opts.draft,
	})
	t.track("payrollRun", run)
	t.track("jafInvoice", invoice)
	return { finance, account, run, invoice }
}

const load = (runId: string) =>
	loader({
		request: new Request(`http://localhost/finance/payroll/${runId}`),
		params: { runId },
		context: {},
	} as never)

const post = (runId: string, fields: Record<string, string>) =>
	action({
		request: new Request(`http://localhost/finance/payroll/${runId}`, {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
		params: { runId },
		context: {},
	} as never)

async function redirectOf(p: Promise<unknown>) {
	try {
		await p
		return null
	} catch (e) {
		if (e instanceof Response) return e.headers.get("Location")
		throw e
	}
}

describe("request ordering", () => {
	it("pins the run's invoice order, with a tiebreaker, in the loader (Review Focus)", async () => {
		const { run } = await seed({ label: "Run order" })
		const findMany = vi.spyOn(db.payrollRun, "findMany")
		try {
			await load(run.id)
			const args = findMany.mock.calls[0]?.[0] as {
				include?: { invoices?: { orderBy?: unknown } }
			}
			// `buildJournalBlocks` sorts blocks by brigade code and jobs by
			// controlNumber internally, so the DB row order only needs to be
			// deterministic.
			expect(args.include?.invoices?.orderBy).toEqual([
				{ releasedToFinanceAt: "asc" },
				{ id: "asc" },
			])
		} finally {
			findMany.mockRestore()
		}
	})

	it("pins the same order in the PDF download, so print matches screen (Review Focus)", async () => {
		const { run } = await seed({ label: "Run order pdf" })
		const findUnique = vi.spyOn(db.payrollRun, "findUniqueOrThrow")
		try {
			const res = await journalLoader({
				request: new Request(
					`http://localhost/finance/payroll/${run.id}/journal`,
				),
				params: { runId: run.id },
				context: {},
			} as never)
			expect(res.headers.get("Content-Type")).toBe("application/pdf")
			expect(res.headers.get("Content-Disposition")).toContain("attachment")
			const args = findUnique.mock.calls[0]?.[0] as {
				include?: { invoices?: { orderBy?: unknown } }
			}
			expect(args.include?.invoices?.orderBy).toEqual([
				{ releasedToFinanceAt: "asc" },
				{ id: "asc" },
			])
		} finally {
			findUnique.mockRestore()
		}
	})
})

describe("payroll request detail", () => {
	it("the loader returns the request sheet line for the brigade, without gross", async () => {
		const { run } = await seed({ code: "009" })
		const result = await load(run.id)
		const line = result.req.lines.find((l) => l.brigadeCode === "009")
		expect(line).toBeDefined()
		expect(line?.brigadeLabel).toBe("Jesús Martínez")
		expect(line?.net).toBeCloseTo(65, 2)
		expect(line?.toPay).toBeCloseTo(58.5, 2)
		expect(JSON.stringify(result.req)).not.toMatch(/gross/i)
		expect(result.req.status).toBe("waiting")
	})

	it("404s for an unknown request", async () => {
		await seed()
		await expect(load("no-such-run")).rejects.toMatchObject({ status: 404 })
	})

	it("requires FINANCE or ADMIN", async () => {
		const { run } = await seed()
		mocks.requireRole.mockClear()
		await load(run.id)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})

	it("send_run hands a draft to Carmen and lands on the Waiting tab", async () => {
		const { run } = await seed({ draft: true })
		expect((await load(run.id)).req.status).toBe("draft")
		expect(await redirectOf(post(run.id, { intent: "send_run" }))).toMatch(
			/^\/finance\/payroll\?tab=waiting&receipt=request_sent&a=/,
		)
		const sent = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(sent.sentAt).not.toBeNull()
		expect((await load(run.id)).req.status).toBe("waiting")
	})

	it("sending twice says it is already sent and changes nothing", async () => {
		const { run } = await seed({ draft: true })
		await redirectOf(post(run.id, { intent: "send_run" }))
		const first = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(await post(run.id, { intent: "send_run" })).toMatchObject({
			errorKey: "finance_payroll.errors.already_sent",
		})
		const again = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(again.sentAt).toEqual(first.sentAt)
	})

	it("discard_run removes a draft; a sent request cannot be discarded", async () => {
		const draft = await seed({ draft: true })
		expect(
			await redirectOf(post(draft.run.id, { intent: "discard_run" })),
		).toBe("/finance/payroll")
		expect(
			await db.payrollRun.findUnique({ where: { id: draft.run.id } }),
		).toBeNull()

		const sent = await seed()
		expect(await post(sent.run.id, { intent: "discard_run" })).toMatchObject({
			errorKey: "finance_payroll.errors.already_sent",
		})
		expect(
			await db.payrollRun.findUnique({ where: { id: sent.run.id } }),
		).not.toBeNull()
	})

	it("has no confirm-from-paper action any more", async () => {
		const { run, account } = await seed()
		for (const intent of ["confirm_account", "batch_confirm"]) {
			expect(
				await post(run.id, {
					intent,
					accountId: account.id,
					paidDate: "2026-09-12",
				}),
			).toMatchObject({ errorKey: "finance_payroll.errors.unknown_intent" })
		}
		const row = await db.payrollRunAccount.findMany({
			where: { payrollRunId: run.id },
		})
		expect(row.every((r) => r.paidAt === null)).toBe(true)
	})
})

describe("request sheet PDF", () => {
	const get = (runId: string) =>
		journalLoader({
			request: new Request(`http://localhost/finance/payroll/${runId}/journal`),
			params: { runId },
			context: {},
		} as never)

	it("Carmen cannot download a draft; Finance can", async () => {
		const { run, finance } = await seed({ draft: true })
		const comptroller = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		mocks.requireRole.mockResolvedValue({ user: comptroller })
		await expect(get(run.id)).rejects.toMatchObject({ status: 404 })
		mocks.requireRole.mockResolvedValue({ user: finance })
		const res = await get(run.id)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
	})
})

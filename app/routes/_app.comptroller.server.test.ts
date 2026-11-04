import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	buildJournalBlocks,
	payrollSheetLines,
	puertoRicoToday,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"
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
import { loader as listsLoader } from "./_app.comptroller.lists"
import { loader as paidLoader } from "./_app.comptroller.paid"
import { action, loader as runLoader } from "./_app.comptroller.runs.$runId"
import { loader as toPayLoader } from "./_app.comptroller.to-pay"

const t = makeTracker()
afterAll(() => t.cleanup())

afterEach(() => {
	mocks.requireRole.mockReset()
})

/** A run with one invoice + PayrollRunAccount row per entry. */
async function seedRun(count = 1, opts: { draft?: boolean } = {}) {
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
				netPayable: 585,
				draft: opts.draft,
			})
			run = seeded.run
			t.track("payrollRun", seeded.run)
			t.track("jafInvoice", seeded.invoice)
		} else {
			const { invoice, run: extraRun } = await seedSweptInvoice({
				generatedById: comptroller.id,
				contractorAccountId: account.id,
				grossPayable: 500,
				netPayable: 292.5,
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

function post(runId: string, fields: Record<string, string | string[]>) {
	const body = new URLSearchParams()
	for (const [k, v] of Object.entries(fields))
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one)
	return action({
		request: new Request(`http://localhost/comptroller/runs/${runId}`, {
			method: "POST",
			body,
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
	it("is Home: the to-pay tile counts an open run and links to its list", async () => {
		mocks.requireRole.mockResolvedValue({
			user: t.track("user", await seedUser({ role: "COMPTROLLER" })),
		})
		const before = await indexLoader({
			request: new Request("http://localhost/comptroller"),
			params: {},
			context: {},
		} as never)
		await seedRun(2)
		const paid = await seedRun(1)
		await db.payrollRun.update({
			where: { id: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})

		const result = await indexLoader({
			request: new Request("http://localhost/comptroller"),
			params: {},
			context: {},
		} as never)

		const tileOf = (r: typeof result) =>
			r.home.tiles.find((x) => x.key === "payroll_to_pay")
		// One open run added; the paid run is not counted.
		expect((tileOf(result)?.count ?? 0) - (tileOf(before)?.count ?? 0)).toBe(1)
		expect(tileOf(result)?.href).toBe("/comptroller/to-pay")
		expect(result.home.week).toHaveLength(4)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})
})

describe("comptroller sidebar views", () => {
	const call = (fn: (a: never) => unknown, path: string) =>
		fn({
			request: new Request(`http://localhost${path}`),
			params: {},
			context: {},
		} as never)

	it("splits runs into Runs to pay and Paid runs", async () => {
		const open = await seedRun(2)
		const paid = await seedRun(1)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})
		await db.payrollRun.update({
			where: { id: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})

		const toPay = (await call(toPayLoader, "/comptroller/to-pay")) as Awaited<
			ReturnType<typeof toPayLoader>
		>
		const done = (await call(paidLoader, "/comptroller/paid")) as Awaited<
			ReturnType<typeof paidLoader>
		>
		expect(toPay.runs.some((r) => r.id === open.run.id)).toBe(true)
		expect(toPay.runs.some((r) => r.id === paid.run.id)).toBe(false)
		expect(done.runs.some((r) => r.id === paid.run.id)).toBe(true)
		expect(done.runs.some((r) => r.id === open.run.id)).toBe(false)
	})

	it("lists every run with its unpaid count, open until fully paid", async () => {
		const open = await seedRun(2)
		const paid = await seedRun(1)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})
		await db.payrollRun.update({
			where: { id: paid.run.id },
			data: { paidAt: new Date(), paidById: paid.comptroller.id },
		})

		const { lists } = (await call(
			listsLoader,
			"/comptroller/lists",
		)) as Awaited<ReturnType<typeof listsLoader>>
		const openRow = lists.find((l) => l.id === open.run.id)
		const paidRow = lists.find((l) => l.id === paid.run.id)
		expect(openRow).toMatchObject({ open: true, unpaid: 2, accountCount: 2 })
		expect(paidRow).toMatchObject({ open: false, unpaid: 0 })
		expect(openRow?.invoiceCount).toBeGreaterThan(0)
		expect(openRow?.total).toBeGreaterThan(0)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})
})

describe("comptroller run loader", () => {
	it("returns one line per brigade matching the sheet, with no gross anywhere", async () => {
		const { accounts, run, comptroller } = await seedRun(2)
		await db.payrollRunAccount.updateMany({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
			data: { paidAt: new Date(), paidById: comptroller.id },
		})

		const result = await load(run.id)
		expect(result.req.lines).toHaveLength(2)

		const full = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { invoices: RUN_INVOICES },
		})
		const sheet = payrollSheetLines(buildJournalBlocks(full.invoices))
		for (const row of result.req.lines) {
			const line = sheet.find((l) => l.brigadeCode === row.brigadeCode)
			expect(line).toBeDefined()
			expect(row.net).toBe(line?.net)
			expect(row.retention).toBe(line?.retention)
			expect(row.toPay).toBe(line?.toPay)
		}
		// Rule 6: nothing in what Carmen is handed carries the JAF price.
		expect(JSON.stringify(result)).not.toMatch(/gross/i)
		const ticked = result.req.lines.find((l) => l.accountId === accounts[0].id)
		const open = result.req.lines.find((l) => l.accountId === accounts[1].id)
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

	it("404s for a draft: Carmen does not see a request until it is sent", async () => {
		const { run } = await seedRun(1, { draft: true })
		expect(await status(load(run.id))).toBe(404)
	})
})

describe("pay_account", () => {
	it("ticks the brigade as the comptroller", async () => {
		const { accounts, run, comptroller } = await seedRun(1)
		const fields = {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: "2026-09-12",
		}
		const receipt = (await post(run.id, fields)) as Response
		expect(receipt.status).toBe(302)
		expect(receipt.headers.get("Location")).toContain("receipt=paid")
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
		})
		expect(row.paidAt).not.toBeNull()
		expect(row.paidById).toBe(comptroller.id)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])

		// A replay (double-click, stale tab) is treated as success, not an error.
		expect(((await post(run.id, fields)) as Response).status).toBe(302)
	})

	it("pays several brigades at once with one date, skipping any already paid", async () => {
		const { accounts, run } = await seedRun(2)
		await post(run.id, {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: puertoRicoToday(),
		})
		const result = (await post(run.id, {
			intent: "pay_accounts",
			accountId: accounts.map((a) => a.id),
			paidDate: puertoRicoToday(),
		})) as Response
		expect(result.status).toBe(302)
		const rows = await db.payrollRunAccount.findMany({
			where: { payrollRunId: run.id },
		})
		expect(rows.every((r) => r.paidAt)).toBe(true)
	})

	it("holds a line with a reason: it cannot be ticked until released, and Lissette is told", async () => {
		const { accounts, run } = await seedRun(1)
		const pay = {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: puertoRicoToday(),
		}
		expect(
			await post(run.id, { intent: "hold", accountId: accounts[0].id }),
		).toMatchObject({ errorKey: "finance_payroll.errors.note_required" })
		await post(run.id, {
			intent: "hold",
			accountId: accounts[0].id,
			text: "paid a different amount in WinPay",
		})
		const held = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(held.holdReason).toBe("paid a different amount in WinPay")
		expect(await post(run.id, pay)).toMatchObject({
			errorKey: "finance_payroll.errors.on_hold",
		})
		await post(run.id, { intent: "release", accountId: accounts[0].id })
		expect(((await post(run.id, pay)) as Response).status).toBe(302)
		const after = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(after.holdReason).toBeNull()
		expect(after.paidAt).not.toBeNull()
		const notes = await db.notification.findMany({
			where: { message: { contains: "paid a different amount in WinPay" } },
		})
		expect(notes.length).toBeGreaterThan(0)
		await db.notification.deleteMany({
			where: { id: { in: notes.map((n) => n.id) } },
		})
	})

	it("keeps a note on a line for Lissette without changing its state", async () => {
		const { accounts, run } = await seedRun(1)
		await post(run.id, {
			intent: "ask",
			accountId: accounts[0].id,
			text: "is the 009D share 80%?",
		})
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(row.askNote).toBe("is the 009D share 80%?")
		expect(row.paidAt).toBeNull()
		expect(row.holdReason).toBeNull()
		await db.notification.deleteMany({
			where: { message: { contains: "is the 009D share 80%?" } },
		})
	})

	it("undoes a tick made today with a reason, and reopens the brigade", async () => {
		const { accounts, run } = await seedRun(1)
		const fields = {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: puertoRicoToday(),
		}
		await post(run.id, fields)
		expect(
			await post(run.id, { intent: "undo_paid", accountId: accounts[0].id }),
		).toMatchObject({ errorKey: "finance_payroll.errors.undo_reason" })
		expect(
			await post(run.id, {
				intent: "undo_paid",
				accountId: accounts[0].id,
				reason: "wrong brigade",
			}),
		).toMatchObject({ ok: true })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
		})
		expect(row.paidAt).toBeNull()
		expect(row.paidById).toBeNull()
		const audit = await db.auditTrail.findMany({
			where: {
				action: "PAYROLL_PAID_UNDONE",
				diffJson: { path: ["reason"], equals: "wrong brigade" },
			},
		})
		expect(audit.length).toBeGreaterThan(0)
		await db.auditTrail.deleteMany({
			where: { id: { in: audit.map((a) => a.id) } },
		})
	})

	it("refuses to undo a tick stamped on an earlier day", async () => {
		const { accounts, run } = await seedRun(1)
		await post(run.id, {
			intent: "pay_account",
			accountId: accounts[0].id,
			paidDate: puertoRicoToday(),
		})
		await db.jafInvoice.updateMany({
			where: { payrollRunId: run.id },
			data: { payablesClosedAt: new Date(Date.now() - 2 * 86_400_000) },
		})
		expect(
			await post(run.id, {
				intent: "undo_paid",
				accountId: accounts[0].id,
				reason: "late",
			}),
		).toMatchObject({ errorKey: "finance_payroll.errors.undo_expired" })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: accounts[0].id },
		})
		expect(row.paidAt).not.toBeNull()
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

	it("404s a tick on a draft that has not been sent to Carmen, and stamps nothing", async () => {
		const { accounts, run } = await seedRun(1, { draft: true })
		expect(
			await status(
				post(run.id, {
					intent: "pay_account",
					accountId: accounts[0].id,
					paidDate: "2026-09-12",
				}),
			),
		).toBe(404)
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

import { stat } from "node:fs/promises"
import { join, sep } from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
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

const t = makeTracker()
afterAll(() => t.cleanup())

const originalFallback = process.env.PAYROLL_FALLBACK_ENABLED
afterEach(() => {
	if (originalFallback === undefined)
		delete process.env.PAYROLL_FALLBACK_ENABLED
	else process.env.PAYROLL_FALLBACK_ENABLED = originalFallback
})

describe("journal ordering", () => {
	it("pins the run's invoice order, with a tiebreaker, in the loader (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run order",
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		const findUnique = vi.spyOn(db.payrollRun, "findUniqueOrThrow")
		try {
			await loader({
				request: new Request(`http://localhost/finance/payroll/${run.id}`),
				params: { runId: run.id },
				context: {},
			} as never)

			const args = findUnique.mock.calls[0]?.[0] as {
				include?: { invoices?: { orderBy?: unknown } }
			}
			// `buildJournalBlocks` sorts blocks by brigade code and jobs by
			// controlNumber internally, so the DB row order only needs to be
			// deterministic — it affects which invoices fall into which block
			// but not the running totals (which restart per brigade).
			expect(args.include?.invoices?.orderBy).toEqual([
				{ releasedToFinanceAt: "asc" },
				{ id: "asc" },
			])
		} finally {
			findUnique.mockRestore()
		}
	})

	it("pins the same order in the PDF branch, so print matches screen (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run order pdf",
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		const form = new FormData()
		form.set("intent", "download_journal_pdf")
		const findUnique = vi.spyOn(db.payrollRun, "findUniqueOrThrow")
		try {
			await action({
				request: new Request(`http://localhost/finance/payroll/${run.id}`, {
					method: "POST",
					body: form,
				}),
				params: { runId: run.id },
				context: {},
			} as never)

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

describe("L3 run detail", () => {
	it("loader returns journal blocks for the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "009", label: "Jesús Martínez" }),
		)
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run detail",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		const result = await loader({
			request: new Request(`http://localhost/finance/payroll/${run.id}`),
			params: { runId: run.id },
			context: {},
		} as never)
		// generateRun sweeps every Arm-A-open job in the shared dev DB, so other
		// test files' jobs can land in this run. Assert our block is present with
		// the right figures rather than that it is the only one.
		const block = result.blocks.find(
			(b: { brigadeCode: string }) => b.brigadeCode === "009",
		)
		expect(block).toBeDefined()
		expect(block?.brigadeLabel).toBe("Jesús Martínez")
		expect(block?.gross).toBeCloseTo(100, 2)
	})

	it("batch_confirm requires paidDate, then closes the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run confirm",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)
		// closePayrollRun ticks the run's PayrollRunAccount rows, which
		// generateRun normally creates.
		await db.payrollRunAccount.create({
			data: { payrollRunId: run.id, contractorAccountId: account.id },
		})

		const missingFields = new URLSearchParams({ intent: "batch_confirm" })
		const blockedResult = await action({
			request: new Request(`http://localhost/finance/payroll/${run.id}`, {
				method: "POST",
				body: missingFields,
			}),
			params: { runId: run.id },
			context: {},
		} as never)
		expect(blockedResult).toMatchObject({ errorKey: expect.any(String) })

		const validFields = new URLSearchParams({
			intent: "batch_confirm",
			paidDate: "2026-09-12",
		})
		let redirected: string | null = null
		try {
			await action({
				request: new Request(`http://localhost/finance/payroll/${run.id}`, {
					method: "POST",
					body: validFields,
				}),
				params: { runId: run.id },
				context: {},
			} as never)
		} catch (response) {
			if (response instanceof Response)
				redirected = response.headers.get("Location")
		}
		expect(redirected).toBe("/finance/payroll")
		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloaded.confirmedByFallback).toBe(true)
	})

	it("never writes evidence outside the upload dir, whatever the filename claims", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run traversal",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		// A multipart filename is client-controlled and path.join normalises the
		// ".." segments out of the upload dir, so this must not reach the FS.
		const form = new FormData()
		form.set("intent", "batch_confirm")
		form.set("paidDate", "2026-09-12")
		form.append(
			"evidence",
			new File(["%PDF-1.4 fake"], "../../../../../../tmp/pwned.pdf", {
				type: "application/pdf",
			}),
		)
		await action({
			request: new Request(`http://localhost/finance/payroll/${run.id}`, {
				method: "POST",
				body: form,
			}),
			params: { runId: run.id },
			context: {},
		} as never).catch(() => undefined)

		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloaded.evidencePath).not.toBeNull()
		// `||` not `??`: .env sets UPLOAD_DIR="" (empty, not unset), which `??`
		// would let through and resolve the path relative to the CWD instead.
		const dir = join(
			process.env.UPLOAD_DIR || "/tmp/jaf/uploads",
			"payroll-runs",
		)
		expect(reloaded.evidencePath?.startsWith(`${dir}${sep}`)).toBe(true)
		expect(reloaded.evidencePath).not.toContain("..")
		// The escaped target must not exist.
		await expect(stat("/tmp/pwned.pdf")).rejects.toThrow()
		// The file really landed inside the upload dir, and nothing leaked into
		// the repo working directory.
		await expect(stat(reloaded.evidencePath as string)).resolves.toBeTruthy()
		await expect(stat(join(process.cwd(), "payroll-runs"))).rejects.toThrow()
	})

	it("rejects evidence with a wrong MIME type server-side (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run evidence",
			grossPayable: 100,
			retentionAmount: 100 * 0.65 * 0.1,
			netPayable: 100 * 0.65 * 0.9,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		// FormData, not URLSearchParams: the latter stringifies the appended File
		// and the action would never see an upload at all.
		const form = new FormData()
		form.set("intent", "batch_confirm")
		form.set("paidDate", "2026-09-12")
		// Extension is allowed by validateFile's "file" branch, so only the
		// explicit MIME check can catch this.
		form.append(
			"evidence",
			new File(["#!/bin/sh\nrm -rf /"], "ach-proof.pdf", {
				type: "application/x-sh",
			}),
		)
		const result = await action({
			request: new Request(`http://localhost/finance/payroll/${run.id}`, {
				method: "POST",
				body: form,
			}),
			params: { runId: run.id },
			context: {},
		} as never)
		expect(result).toMatchObject({
			errorKey: "finance_payroll.errors.invalid_evidence",
		})

		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloaded.paidAt).toBeNull()
	})
})

describe("per-account confirm", () => {
	async function runWithAccount() {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run account",
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)
		await db.payrollRunAccount.create({
			data: { payrollRunId: run.id, contractorAccountId: account.id },
		})
		return { finance, account, run }
	}

	function post(runId: string, fields: Record<string, string>) {
		return action({
			request: new Request(`http://localhost/finance/payroll/${runId}`, {
				method: "POST",
				body: new URLSearchParams(fields),
			}),
			params: { runId },
			context: {},
		} as never)
	}

	const load = (runId: string) =>
		loader({
			request: new Request(`http://localhost/finance/payroll/${runId}`),
			params: { runId },
			context: {},
		} as never)

	async function status(r: unknown) {
		try {
			await r
			return 200
		} catch (e) {
			if (e instanceof Response) return e.status
			throw e
		}
	}

	it("loader returns one unpaid accounts row per account", async () => {
		const { account, run } = await runWithAccount()
		const result = await load(run.id)
		expect(result.accounts).toHaveLength(1)
		expect(result.accounts[0]).toMatchObject({
			accountId: account.id,
			code: account.code,
			jobs: 1,
			paidAt: null,
			confirmedByFallback: false,
		})
		expect(result.fallbackEnabled).toBe(true)
	})

	it("confirm_account ticks the account as a fallback, and a replay is a 409", async () => {
		const { finance, account, run } = await runWithAccount()
		const fields = {
			intent: "confirm_account",
			accountId: account.id,
			paidDate: "2026-09-12",
		}
		expect(await post(run.id, fields)).toMatchObject({ ok: true })
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id, contractorAccountId: account.id },
		})
		expect(row.paidAt).not.toBeNull()
		expect(row.paidById).toBe(finance.id)
		expect(row.confirmedByFallback).toBe(true)
		const shown = (await load(run.id)).accounts[0]
		expect(shown.paidByName).toBe(finance.name)
		expect(shown.confirmedByFallback).toBe(true)

		expect(await status(post(run.id, fields))).toBe(409)
	})

	it("confirm_account with an account from another run is a 404", async () => {
		const { run } = await runWithAccount()
		const other = t.track("contractorAccount", await seedContractorAccount())
		expect(
			await status(
				post(run.id, {
					intent: "confirm_account",
					accountId: other.id,
					paidDate: "2026-09-12",
				}),
			),
		).toBe(404)
	})

	it("with the fallback switch off, confirm_account and batch_confirm are 403 and stamp nothing", async () => {
		const { account, run } = await runWithAccount()
		process.env.PAYROLL_FALLBACK_ENABLED = "false"
		expect((await load(run.id)).fallbackEnabled).toBe(false)
		expect(
			await status(
				post(run.id, {
					intent: "confirm_account",
					accountId: account.id,
					paidDate: "2026-09-12",
				}),
			),
		).toBe(403)
		expect(
			await status(
				post(run.id, { intent: "batch_confirm", paidDate: "2026-09-12" }),
			),
		).toBe(403)
		const row = await db.payrollRunAccount.findFirstOrThrow({
			where: { payrollRunId: run.id },
		})
		expect(row.paidAt).toBeNull()
		const reloaded = await db.payrollRun.findUniqueOrThrow({
			where: { id: run.id },
		})
		expect(reloaded.paidAt).toBeNull()
	})
})

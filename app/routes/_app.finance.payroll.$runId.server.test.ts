import { stat } from "node:fs/promises"
import { join, sep } from "node:path"
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

const t = makeTracker()
afterAll(() => t.cleanup())

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
			// `adjNetRunning` accumulates in this order, so it has to be
			// explicit — and releasedToFinanceAt alone is not a total order,
			// because a batch of jobs is released together.
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
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
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
			(b: { accountCode: string }) => b.accountCode === "009",
		)
		expect(block).toBeDefined()
		expect(block?.contractorLabel).toBe("Jesús Martínez")
		expect(block?.gross).toBeCloseTo(100, 2)
	})

	it("batch_confirm requires achDate and achRef, then closes the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		const { run, invoice } = await seedSweptInvoice({
			generatedById: finance.id,
			contractorAccountId: account.id,
			runLabel: "Run confirm",
			grossPayable: 100,
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

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
			achDate: "2026-09-12",
			achRef: "20260912-JAF-015",
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
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		// A multipart filename is client-controlled and path.join normalises the
		// ".." segments out of the upload dir, so this must not reach the FS.
		const form = new FormData()
		form.set("intent", "batch_confirm")
		form.set("achDate", "2026-09-12")
		form.set("achRef", "REF-TRAVERSAL")
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
			retentionAmount: 10,
			netPayable: 100 * 0.65 - 10,
		})
		t.track("payrollRun", run)
		t.track("jafInvoice", invoice)

		// FormData, not URLSearchParams: the latter stringifies the appended File
		// and the action would never see an upload at all.
		const form = new FormData()
		form.set("intent", "batch_confirm")
		form.set("achDate", "2026-09-12")
		form.set("achRef", "REF-EV")
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

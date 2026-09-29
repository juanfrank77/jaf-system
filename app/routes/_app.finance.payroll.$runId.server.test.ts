import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { generateRun } from "~/lib/payroll-run.server"
import {
	makeTracker,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.payroll.$runId"

const t = makeTracker()
afterAll(() => t.cleanup())

describe("L3 run detail", () => {
	it("loader returns journal blocks for the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track(
			"contractorAccount",
			await seedContractorAccount({ code: "009", label: "Jesús Martínez" }),
		)
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				contractorAccountCode: account.code,
				jafInvoiceLines: [
					{
						serviceCodeId: "sc1",
						claroCode: "X",
						name: "X",
						unit: "EA",
						qty: 1,
						unitPrice: 100,
						lineAmount: 100,
					},
				],
			}),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "Run detail",
		})
		t.track("payrollRun", run as { id: string })

		const result = await loader({
			request: new Request(`http://localhost/finance/payroll/${run.id}`),
			params: { runId: run.id },
			context: {},
		} as never)
		expect(result.blocks).toHaveLength(1)
		expect(result.blocks[0].accountCode).toBe("009")
	})

	it("batch_confirm requires achDate and achRef, then closes the run", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "Run confirm",
		})
		t.track("payrollRun", run as { id: string })

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

	it("rejects evidence with a wrong MIME type server-side (Review Focus)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const account = t.track("contractorAccount", await seedContractorAccount())
		t.track(
			"jafInvoice",
			await seedFinanceableInvoice({ contractorAccountCode: account.code }),
		)
		const { run } = await generateRun({
			generatedById: finance.id,
			label: "Run evidence",
		})
		t.track("payrollRun", run as { id: string })

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

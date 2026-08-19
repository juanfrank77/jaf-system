import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		user: { findUniqueOrThrow: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		auditTrail: { create: vi.fn() },
		notification: { create: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	isTerminalStatus: vi.fn(),
	computeFinanceStage: vi.fn(),
	fetchInvoiceTotalContext: vi.fn(),
	invoiceTotalUsed: vi.fn(),
	checkAmountTolerance: vi.fn(),
	isMissingAviso: vi.fn(),
	isMissingClaroPdf: vi.fn(),
	sendInternalEmail: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/permissions", () => ({
	isTerminalStatus: mocks.isTerminalStatus,
}))
vi.mock("~/lib/finance-pipeline.server", () => ({
	computeFinanceStage: mocks.computeFinanceStage,
	fetchInvoiceTotalContext: mocks.fetchInvoiceTotalContext,
	invoiceTotalUsed: mocks.invoiceTotalUsed,
	checkAmountTolerance: mocks.checkAmountTolerance,
	isMissingAviso: mocks.isMissingAviso,
	isMissingClaroPdf: mocks.isMissingClaroPdf,
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))

import { action } from "./_app.finance.verify.$id"

const requestWith = (entries: Record<string, string>) => {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/finance/verify/job-1", {
		method: "POST",
		body: form,
	})
}

const baseDoc = () => ({
	id: "job-1",
	controlNumber: "JAF-1",
	status: "SUPERVISOR_APPROVED",
	supervisorId: "sup-1",
	poLinks: [],
	paymentRecords: [],
	financeSendBackNotes: [],
	supervisor: { email: "sup@example.com" },
})

describe("Finance verify action guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isTerminalStatus.mockReturnValue(false)
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(baseDoc())
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.checkAmountTolerance.mockReturnValue({
			withinTolerance: true,
			difference: 0,
		})
		mocks.isMissingAviso.mockReturnValue(false)
		mocks.isMissingClaroPdf.mockReturnValue(false)
		mocks.db.$transaction.mockResolvedValue(undefined)
	})

	it("rejects terminal LC jobs in the action", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		const result = await action({
			request: requestWith({ intent: "verify", avisoAmount: "100" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.terminal_status",
		})
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("rejects unknown intents before loading or mutating a job", async () => {
		const result = await action({
			request: requestWith({ intent: "bogus" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.unknown_intent",
		})
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("rejects an invalid stage before mutating a job", async () => {
		mocks.computeFinanceStage.mockReturnValue("PBCC_REQUEST_PENDING")
		const result = await action({
			request: requestWith({ intent: "verify", avisoAmount: "100" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.invalid_stage",
		})
		expect(mocks.db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("records a successful verification", async () => {
		const result = await action({
			request: requestWith({
				intent: "verify",
				avisoAmount: "100",
				note: "ok",
			}),
			params: { id: "job-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
		expect(mocks.db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ financeVerifiedAt: expect.any(Date) }),
			}),
		)
	})
})

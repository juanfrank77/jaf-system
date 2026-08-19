import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		user: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		auditTrail: { create: vi.fn() },
		notification: { create: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	isTerminalStatus: vi.fn(),
	computeFinanceStage: vi.fn(),
	invoiceTotalUsed: vi.fn(),
	financeLineItems: vi.fn(),
	getIvuRate: vi.fn(),
	getLcPbccAdvanceRate: vi.fn(),
	generatePbccRequestPdf: vi.fn(),
	sendInternalEmail: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/permissions", () => ({
	isTerminalStatus: mocks.isTerminalStatus,
}))
vi.mock("~/lib/finance-pipeline.server", () => ({
	computeFinanceStage: mocks.computeFinanceStage,
	invoiceTotalUsed: mocks.invoiceTotalUsed,
	financeLineItems: mocks.financeLineItems,
}))
vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: mocks.getIvuRate,
	getLcPbccAdvanceRate: mocks.getLcPbccAdvanceRate,
}))
vi.mock("~/lib/pdf/pbcc-request.server", () => ({
	generatePbccRequestPdf: mocks.generatePbccRequestPdf,
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))

import { action, loader } from "./_app.finance.pbcc.$id"

describe("Finance PBCC guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isTerminalStatus.mockReturnValue(false)
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			id: "job-1",
			controlNumber: "JAF-1",
			status: "SUPERVISOR_APPROVED",
			supervisorId: "sup-1",
			poLinks: [],
			paymentRecords: [],
			supervisor: { name: "Sup", email: "sup@example.com" },
		})
		mocks.computeFinanceStage.mockReturnValue("PBCC_REQUEST_PENDING")
		mocks.db.serviceCode.findMany.mockResolvedValue([])
		mocks.getIvuRate.mockResolvedValue(0.115)
		mocks.getLcPbccAdvanceRate.mockResolvedValue(0.5)
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.generatePbccRequestPdf.mockResolvedValue(Buffer.from("pdf"))
		mocks.db.user.findMany.mockResolvedValue([])
		mocks.db.$transaction.mockResolvedValue(undefined)
	})

	it("loader rejects terminal LC jobs", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		await expect(
			loader({
				request: new Request("http://localhost/finance/pbcc/job-1"),
				params: { id: "job-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects terminal LC jobs", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		const form = new FormData()
		form.set("intent", "generate_pbcc")
		const result = await action({
			request: new Request("http://localhost/finance/pbcc/job-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({ errorKey: "finance_pbcc.errors.terminal_status" })
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("loader rejects wrong stage", async () => {
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		await expect(
			loader({
				request: new Request("http://localhost/finance/pbcc/job-1"),
				params: { id: "job-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects wrong stage", async () => {
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		const form = new FormData()
		form.set("intent", "generate_pbcc")
		const result = await action({
			request: new Request("http://localhost/finance/pbcc/job-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "job-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
	})
})

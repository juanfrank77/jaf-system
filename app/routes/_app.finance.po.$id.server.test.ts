import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		auditTrail: { create: vi.fn() },
		notification: { create: vi.fn() },
		poLink: { create: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	isTerminalStatus: vi.fn(),
	computeFinanceStage: vi.fn(),
	fetchInvoiceTotalContext: vi.fn(),
	invoiceTotalUsed: vi.fn(),
	financeLineItems: vi.fn(),
	getIvuRate: vi.fn(),
	checkAmountTolerance: vi.fn(),
	generateFinalClaroDocPdf: vi.fn(),
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
	financeLineItems: mocks.financeLineItems,
	checkAmountTolerance: mocks.checkAmountTolerance,
}))
vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: mocks.getIvuRate,
}))
vi.mock("~/lib/pdf/final-claro-doc.server", () => ({
	generateFinalClaroDocPdf: mocks.generateFinalClaroDocPdf,
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))

import { action, loader } from "./_app.finance.po.$id"

describe("Finance PO guards", () => {
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
			supervisor: { email: "sup@example.com" },
		})
		mocks.computeFinanceStage.mockReturnValue("WAITING_CLARO_PO")
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.getIvuRate.mockResolvedValue(0.115)
		mocks.checkAmountTolerance.mockReturnValue({
			withinTolerance: true,
			difference: 0,
		})
	})

	it("loader rejects terminal LC jobs", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		await expect(
			loader({
				request: new Request("http://localhost/finance/po/job-1"),
				params: { id: "job-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects terminal LC jobs", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		const form = new FormData()
		form.set("intent", "record_po")
		form.set("poNumber", "PO-1")
		const result = await action({
			request: new Request("http://localhost/finance/po/job-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({ errorKey: "finance_po.errors.terminal_status" })
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("loader rejects wrong stage", async () => {
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		await expect(
			loader({
				request: new Request("http://localhost/finance/po/job-1"),
				params: { id: "job-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("action rejects wrong stage", async () => {
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		const form = new FormData()
		form.set("intent", "record_po")
		form.set("poNumber", "PO-1")
		const result = await action({
			request: new Request("http://localhost/finance/po/job-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "job-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
	})
})

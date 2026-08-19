import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		user: { findMany: vi.fn() },
		notification: { createMany: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	isComptrollerEnabled: vi.fn(),
	computeFinanceStage: vi.fn(),
	recordReceivablePayment: vi.fn(),
	sendInternalEmail: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/features.server", () => ({
	isComptrollerEnabled: mocks.isComptrollerEnabled,
}))
vi.mock("~/lib/finance-pipeline.server", () => ({
	computeFinanceStage: mocks.computeFinanceStage,
}))
vi.mock("~/lib/payment-records.server", () => ({
	parsePaymentDate: (value: string | null) =>
		value ? new Date("2026-02-28") : null,
	recordReceivablePayment: mocks.recordReceivablePayment,
	paymentForType: vi.fn(),
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))

import { action } from "./_app.finance.receivables"

const requestWith = (entries: Record<string, string>) => {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/finance/receivables", {
		method: "POST",
		body: form,
	})
}

const doc = {
	id: "job-1",
	controlNumber: "JAF-1",
	status: "CLARO_UPLOADED",
	poLinks: [],
	paymentRecords: [],
}

describe("Finance receivables action guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isComptrollerEnabled.mockReturnValue(true)
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(doc)
		mocks.computeFinanceStage.mockReturnValue("WAITING_PBCC_FUNDING")
		mocks.recordReceivablePayment.mockResolvedValue({
			duplicate: false,
			record: {},
		})
		mocks.db.user.findMany.mockResolvedValue([])
	})

	it("rejects unknown intents before loading or mutating a job", async () => {
		const result = await action({
			request: requestWith({ intent: "verify" }),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "finance_receivables.errors.unknown_intent",
		})
		expect(mocks.db.jafInvoice.findUniqueOrThrow).not.toHaveBeenCalled()
	})

	it("rejects a final payment outside IN_CLARO_QUEUE", async () => {
		const result = await action({
			request: requestWith({
				intent: "record_final",
				docId: "job-1",
				finalAmount: "10",
				paymentDate: "2026-02-28",
			}),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "finance_receivables.errors.invalid_stage",
		})
		expect(mocks.recordReceivablePayment).not.toHaveBeenCalled()
	})

	it("records the actual advance with date and note", async () => {
		const result = await action({
			request: requestWith({
				intent: "record_advance",
				docId: "job-1",
				advanceAmount: "12.50",
				paymentDate: "2026-02-28",
				paymentNote: "wire",
			}),
			params: {},
		} as any)
		expect(result).toBeNull()
		expect(mocks.recordReceivablePayment).toHaveBeenCalledWith(
			expect.objectContaining({
				jobId: "job-1",
				type: "PBCC_ADVANCE",
				amount: 12.5,
				note: "wire",
				actorId: "finance-1",
			}),
		)
		expect(mocks.sendInternalEmail).toHaveBeenCalled()
	})

	it("blocks a Comptroller when the portal feature is disabled", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "comptroller-1", role: "COMPTROLLER" },
		})
		mocks.isComptrollerEnabled.mockReturnValue(false)
		await expect(
			action({
				request: requestWith({ intent: "record_advance" }),
				params: {},
			} as any),
		).rejects.toMatchObject({ status: 404 })
	})

	it("does not allow Comptroller to close a receivable", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "comptroller-1", role: "COMPTROLLER" },
		})
		const result = await action({
			request: requestWith({ intent: "close", docId: "job-1" }),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "finance_receivables.errors.close_role_required",
		})
	})
})

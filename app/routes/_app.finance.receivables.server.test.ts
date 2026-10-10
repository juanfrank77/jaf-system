import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
		user: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
		notification: { createMany: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	getSession: vi.fn(),
	computeFinanceStage: vi.fn(),
	recordReceivablePayment: vi.fn(),
	sendInternalEmail: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({
	requireRole: mocks.requireRole,
}))
vi.mock("~/lib/auth.server", () => ({
	auth: { api: { getSession: mocks.getSession } },
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

import { action, loader } from "./_app.finance.receivables"

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

	it("restricts both loader and action to FINANCE and ADMIN", async () => {
		mocks.db.jafInvoice.findMany.mockResolvedValue([])
		await loader({
			request: new Request("http://localhost/finance/receivables"),
			params: {},
		} as any).catch(() => undefined)
		await action({
			request: requestWith({ intent: "verify" }),
			params: {},
		} as any)
		expect(mocks.requireRole).toHaveBeenCalledTimes(2)
		expect(mocks.requireRole).toHaveBeenNthCalledWith(1, expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
		expect(mocks.requireRole).toHaveBeenNthCalledWith(2, expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})
})

describe("Finance receivables real role guard", () => {
	it("redirects a COMPTROLLER to /dashboard from loader and action", async () => {
		const real = await vi.importActual<
			typeof import("~/lib/permissions.server")
		>("~/lib/permissions.server")
		mocks.requireRole.mockImplementation(real.requireRole)
		mocks.getSession.mockResolvedValue({ user: { id: "comp-1" } })
		mocks.db.user.findUniqueOrThrow.mockResolvedValue({
			id: "comp-1",
			role: "COMPTROLLER",
		})

		for (const call of [
			() =>
				loader({
					request: new Request("http://localhost/finance/receivables"),
					params: {},
				} as any),
			() =>
				action({
					request: requestWith({ intent: "close" }),
					params: {},
				} as any),
		]) {
			const thrown = await call().then(
				() => null,
				(e: unknown) => e,
			)
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).headers.get("Location")).toBe("/dashboard")
		}
	})
})

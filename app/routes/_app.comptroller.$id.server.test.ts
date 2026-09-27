import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		brigade: { findMany: vi.fn() },
		notification: { createMany: vi.fn(), findFirst: vi.fn() },
		paymentRecord: { findFirst: vi.fn(), create: vi.fn() },
		auditTrail: { create: vi.fn() },
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
	FINANCEABLE_STATUSES: [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_REQUEST_GENERATED",
	],
	invoiceTotalUsed: vi.fn(() => 100),
}))
vi.mock("~/lib/payment-records.server", () => ({
	parsePaymentDate: (value: string | null) =>
		value ? new Date("2026-02-28") : null,
	paymentForType: (records: Array<{ type: string }>, type: string) =>
		records.find((record) => record.type === type) ?? null,
	recordReceivablePayment: mocks.recordReceivablePayment,
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))
vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: vi.fn(async () => 0.115),
	getLcPbccAdvanceRate: vi.fn(async () => 0.8),
}))

import { action, loader } from "./_app.comptroller.$id"

const requestWith = (entries: Record<string, string>) => {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/comptroller/job-1", {
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

describe("Comptroller payment action guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isComptrollerEnabled.mockReturnValue(true)
		mocks.requireRole.mockResolvedValue({
			user: { id: "comptroller-1", role: "COMPTROLLER" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(doc)
		mocks.computeFinanceStage.mockReturnValue("WAITING_PBCC_FUNDING")
		mocks.recordReceivablePayment.mockResolvedValue({
			duplicate: false,
			record: {},
		})
		mocks.db.user.findMany.mockResolvedValue([])
		mocks.db.serviceCode.findMany.mockResolvedValue([])
	})

	it("enforces the feature flag before action work", async () => {
		mocks.isComptrollerEnabled.mockReturnValue(false)
		await expect(
			action({
				request: requestWith({ intent: "record_advance" }),
				params: { id: "job-1" },
			} as any),
		).rejects.toMatchObject({ init: { status: 404 } })
		expect(mocks.db.jafInvoice.findUniqueOrThrow).not.toHaveBeenCalled()
	})

	it("uses the payment-record helper for PBCC payment data", async () => {
		const result = await action({
			request: requestWith({
				intent: "record_advance",
				amount: "80",
				date: "2026-02-28",
				paymentNote: "PBCC wire",
			}),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			successKey: "comptroller_detail.success.advance_recorded",
		})
		expect(mocks.recordReceivablePayment).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "PBCC_ADVANCE",
				amount: 80,
				note: "PBCC wire",
				actorId: "comptroller-1",
			}),
		)
		expect(mocks.sendInternalEmail).toHaveBeenCalledWith(
			expect.objectContaining({ context: "PBCC_ADVANCE_RECEIVED" }),
		)
	})

	it("rejects repeated or out-of-stage payment actions", async () => {
		mocks.computeFinanceStage.mockReturnValue("WAITING_CLARO_PO")
		const result = await action({
			request: requestWith({
				intent: "record_final",
				amount: "20",
				date: "2026-02-28",
			}),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "comptroller_detail.errors.invalid_stage",
		})
		expect(mocks.recordReceivablePayment).not.toHaveBeenCalled()
	})
})

describe("Comptroller detail loader — crew assignment history", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isComptrollerEnabled.mockReturnValue(true)
		mocks.requireRole.mockResolvedValue({
			user: { id: "comptroller-1", role: "COMPTROLLER" },
		})
		mocks.computeFinanceStage.mockReturnValue("WAITING_PBCC_FUNDING")
		mocks.db.serviceCode.findMany.mockResolvedValue([])
		mocks.db.user.findMany.mockResolvedValue([])
		mocks.db.brigade.findMany.mockResolvedValue([])
		mocks.db.notification.findFirst.mockResolvedValue(null)
	})

	it("does not throw for a doc reassigned via the new brigade-reassign history shape", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...doc,
			assignedCrewIds: ["u-a", "u-b"],
			crewAssignmentHistory: [
				{ brigadeId: "b2", by: "sup1", at: "2026-01-01T00:00:00.000Z" },
			],
			poLinks: [],
			paymentRecords: [],
		})
		mocks.db.brigade.findMany.mockResolvedValue([
			{ id: "b2", name: "Brigada Norte" },
		])

		const result = await loader({
			request: new Request("http://localhost/comptroller/job-1"),
			params: { id: "job-1" },
		} as any)

		expect(result.historyWithNames).toHaveLength(1)
		expect(result.historyWithNames[0].crewNames).toEqual(["Brigada Norte"])
		expect(result.historyWithNames[0].assignedByName).toBe("sup1")
	})

	it("still resolves names for the legacy individual-crew history shape", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...doc,
			assignedCrewIds: ["u-a"],
			crewAssignmentHistory: [
				{
					userIds: ["u-a"],
					assignedById: "sup1",
					assignedAt: "2026-01-01T00:00:00.000Z",
				},
			],
			poLinks: [],
			paymentRecords: [],
		})
		mocks.db.user.findMany.mockResolvedValue([{ id: "u-a", name: "Ana" }])

		const result = await loader({
			request: new Request("http://localhost/comptroller/job-1"),
			params: { id: "job-1" },
		} as any)

		expect(result.historyWithNames[0].crewNames).toEqual(["Ana"])
	})
})

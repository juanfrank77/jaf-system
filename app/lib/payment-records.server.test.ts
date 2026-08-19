import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
	paymentRecord: { findUnique: vi.fn(), create: vi.fn() },
	jafInvoice: { update: vi.fn() },
	auditTrail: { create: vi.fn() },
}))
vi.mock("./db.server", () => ({
	db: {
		$transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
			callback(tx),
		),
		paymentRecord: { findUnique: vi.fn() },
	},
}))

import {
	parsePaymentDate,
	recordReceivablePayment,
} from "./payment-records.server"

describe("payment records", () => {
	beforeEach(() => vi.clearAllMocks())
	it("parses strict local dates", () => {
		expect(parsePaymentDate("2026-02-28")?.getDate()).toBe(28)
		expect(parsePaymentDate("2026-02-30")).toBeNull()
	})
	it("records a receivable payment, compatibility scalar, and audit", async () => {
		vi.mocked(tx.paymentRecord.findUnique).mockResolvedValue(null)
		vi.mocked(tx.paymentRecord.create).mockResolvedValue({
			id: "payment-1",
		} as never)
		vi.mocked(tx.jafInvoice.update).mockResolvedValue({} as never)
		vi.mocked(tx.auditTrail.create).mockResolvedValue({} as never)
		const date = new Date("2026-02-28")
		const result = await recordReceivablePayment({
			jobId: "job-1",
			type: "PBCC_ADVANCE",
			amount: 10,
			date,
			note: "wire",
			actorId: "user-1",
		})
		expect(result.duplicate).toBe(false)
		expect(tx.paymentRecord.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					type: "PBCC_ADVANCE",
					amount: 10,
					date,
					note: "wire",
				}),
			}),
		)
		expect(tx.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "job-1" },
			data: { advanceReceivedAt: date, advanceAmount: 10 },
		})
		expect(tx.auditTrail.create).toHaveBeenCalled()
	})
})

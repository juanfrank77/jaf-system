import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
	paymentRecord: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
	jafInvoice: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
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
	correctReceivablePayment,
	recordReceivablePayment,
} from "./payment-records.server"

describe("payment records", () => {
	beforeEach(() => vi.clearAllMocks())
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

	describe("correctReceivablePayment", () => {
		const date = new Date("2026-03-02T12:00:00")
		const input = {
			jobId: "job-1",
			amount: 850,
			date,
			note: "ACH-OK",
			reason: "bank statement",
			actorId: "user-1",
			actorRole: "FINANCE" as const,
		}
		const existing = {
			id: "payment-1",
			amount: 800,
			date: new Date("2026-03-01T12:00:00"),
			note: "TYPO",
		}

		it("updates the record and the invoice scalars and writes one ADVANCE_CORRECTED audit", async () => {
			vi.mocked(tx.paymentRecord.findUnique).mockResolvedValue(
				existing as never,
			)
			vi.mocked(tx.jafInvoice.findUniqueOrThrow).mockResolvedValue({
				payrollRun: null,
			} as never)
			const result = await correctReceivablePayment(input)
			expect(result).toEqual({ ok: true })
			expect(tx.paymentRecord.update).toHaveBeenCalledWith({
				where: { id: "payment-1" },
				data: { amount: 850, date, note: "ACH-OK" },
			})
			expect(tx.jafInvoice.update).toHaveBeenCalledWith({
				where: { id: "job-1" },
				data: { advanceReceivedAt: date, advanceAmount: 850 },
			})
			expect(tx.auditTrail.create).toHaveBeenCalledTimes(1)
			const data = vi.mocked(tx.auditTrail.create).mock.calls[0][0].data
			expect(data.action).toBe("ADVANCE_CORRECTED")
			expect(data.diffJson).toEqual({
				old: {
					amount: 800,
					date: existing.date.toISOString(),
					note: "TYPO",
				},
				new: { amount: 850, date: date.toISOString(), note: "ACH-OK" },
				reason: "bank statement",
			})
		})

		it("returns not_funded when there is no PBCC_ADVANCE record", async () => {
			vi.mocked(tx.paymentRecord.findUnique).mockResolvedValue(null)
			expect(await correctReceivablePayment(input)).toEqual({
				ok: false,
				error: "not_funded",
			})
			expect(tx.paymentRecord.update).not.toHaveBeenCalled()
		})

		it("is locked for non-admins once the run is paid, and changes nothing", async () => {
			vi.mocked(tx.paymentRecord.findUnique).mockResolvedValue(
				existing as never,
			)
			vi.mocked(tx.jafInvoice.findUniqueOrThrow).mockResolvedValue({
				payrollRun: { paidAt: new Date() },
			} as never)
			expect(await correctReceivablePayment(input)).toEqual({
				ok: false,
				error: "locked",
			})
			expect(tx.paymentRecord.update).not.toHaveBeenCalled()
			expect(tx.jafInvoice.update).not.toHaveBeenCalled()
			expect(tx.auditTrail.create).not.toHaveBeenCalled()
		})

		it("lets an ADMIN correct after the paid run and flags it in the audit", async () => {
			vi.mocked(tx.paymentRecord.findUnique).mockResolvedValue(
				existing as never,
			)
			vi.mocked(tx.jafInvoice.findUniqueOrThrow).mockResolvedValue({
				payrollRun: { paidAt: new Date() },
			} as never)
			expect(
				await correctReceivablePayment({ ...input, actorRole: "ADMIN" }),
			).toEqual({ ok: true })
			const data = vi.mocked(tx.auditTrail.create).mock.calls[0][0].data
			expect(data.diffJson).toMatchObject({ afterPaidRun: true })
		})
	})
})

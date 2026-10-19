import { describe, expect, it, vi } from "vitest"

vi.mock("./db.server", () => ({ db: {} }))
vi.mock("./system-settings.server", () => ({
	getAvisoAmountTolerance: vi.fn(),
	getIvuRate: vi.fn(),
}))

import {
	computeFinanceStage,
	daysInStage,
	FINANCEABLE_STATUSES,
} from "./finance-pipeline.server"

const invoice = (overrides: Record<string, unknown> = {}) => ({
	status: "CLARO_UPLOADED" as const,
	receivableClosedAt: null,
	advanceReceivedAt: null,
	finalPaymentReceivedAt: null,
	finalClaroUploadedAt: null,
	pbccRequestSentAt: null,
	financeVerifiedAt: null,
	supervisorApprovedAt: new Date("2026-01-01"),
	...overrides,
})

describe("finance pipeline stages", () => {
	it("derives payment stages from PaymentRecords instead of scalar compatibility fields", () => {
		expect(
			computeFinanceStage(
				invoice({ advanceReceivedAt: new Date() }),
				false,
				[],
			),
		).toBe("TO_VERIFY")
		expect(
			computeFinanceStage(invoice(), false, [{ type: "PBCC_ADVANCE" }]),
		).toBe("WAITING_CLARO_PO")
		expect(
			computeFinanceStage(
				invoice({ finalClaroUploadedAt: new Date() }),
				false,
				[{ type: "PBCC_ADVANCE" }, { type: "CLARO_FINAL" }],
			),
		).toBe("READY_TO_CLOSE")
	})

	it("uses receivableClosedAt as the only closure source", () => {
		expect(
			computeFinanceStage(
				invoice({ receivableClosedAt: new Date() }),
				false,
				[],
			),
		).toBe("CLOSED")
		expect(
			computeFinanceStage(
				invoice({
					advanceReceivedAt: new Date(),
					finalPaymentReceivedAt: new Date(),
				}),
				false,
				[{ type: "PBCC_ADVANCE" }],
			),
		).not.toBe("CLOSED")
	})

	it("uses payment dates for payment-stage aging", () => {
		const date = new Date(Date.now() - 3 * 86400000)
		const stage = computeFinanceStage(invoice(), false, [
			{ type: "PBCC_ADVANCE", date },
		])
		expect(stage).toBe("WAITING_CLARO_PO")
		if (!stage) throw new Error("Expected a finance stage")
		expect(
			daysInStage(invoice(), stage, null, [{ type: "PBCC_ADVANCE", date }]),
		).toBeGreaterThanOrEqual(3)
	})
})

describe("FINANCEABLE_STATUSES", () => {
	it("pins today's behaviour: SUPERVISOR_APPROVED stays financeable", () => {
		expect(FINANCEABLE_STATUSES).toEqual([
			"SUPERVISOR_APPROVED",
			"CLARO_UPLOADED",
			"LC_REQUEST_GENERATED",
		])
	})
})

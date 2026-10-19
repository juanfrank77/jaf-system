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
	financeLineItems,
	invoiceTotalUsed,
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

describe("finance material lines: brigade's own stock is tracked, not billed", () => {
	const codeMap = {
		m1: { claroCode: "1005803", name: "Drop", unit: "FT", unitPrice: 2 },
		m2: { claroCode: "1005900", name: "Clamp", unit: "EA", unitPrice: 5 },
	}
	const taken = [{ serviceCodeId: "m1", qty: 10 }]
	const split = [
		{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
		{ serviceCodeId: "m1", used: 4, returned: 0, source: "BRIGADE_STOCK" },
	]

	it("a Field save under the ruling bills the 6 warehouse units only", () => {
		const doc = {
			materialsTaken: taken,
			materialsUsed: [{ serviceCodeId: "m1", qty: 6 }],
			fieldMaterials: split,
		}
		expect(financeLineItems(doc, codeMap).map((l) => l.qty)).toEqual([6])
		expect(invoiceTotalUsed(doc, codeMap, 0)).toBe(12)
	})

	it("a row saved before the ruling (materialsUsed = 10) still bills 6", () => {
		const doc = {
			materialsTaken: taken,
			materialsUsed: [{ serviceCodeId: "m1", qty: 10 }],
			fieldMaterials: split,
		}
		expect(financeLineItems(doc, codeMap).map((l) => l.qty)).toEqual([6])
	})

	it("only brigade's stock used: nothing billed, not the signed-out pickup", () => {
		const doc = {
			materialsTaken: taken,
			materialsUsed: [],
			fieldMaterials: [
				{ serviceCodeId: "m1", used: 0, returned: 10, source: "WAREHOUSE" },
				{ serviceCodeId: "m2", used: 3, returned: 0, source: "BRIGADE_STOCK" },
			],
		}
		expect(financeLineItems(doc, codeMap)).toEqual([])
		expect(invoiceTotalUsed(doc, codeMap, 0.115)).toBe(0)
	})

	it("a legacy job without the Field table is unchanged", () => {
		const used = {
			materialsTaken: taken,
			materialsUsed: [{ serviceCodeId: "m1", qty: 7 }],
		}
		expect(financeLineItems(used, codeMap)).toEqual([
			{
				claroCode: "1005803",
				name: "Drop",
				qty: 7,
				unit: "FT",
				unitPrice: 2,
				accountCode: undefined,
			},
		])
		// Nothing reported used yet: Finance reads the pickup, as before.
		const none = { materialsTaken: taken, materialsUsed: null }
		expect(financeLineItems(none, codeMap).map((l) => l.qty)).toEqual([10])
		expect(invoiceTotalUsed(none, codeMap, 0)).toBe(20)
	})
})

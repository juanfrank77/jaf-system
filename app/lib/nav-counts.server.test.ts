import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUnique: vi.fn() },
		jafInvoice: { count: vi.fn() },
		restockRequest: { count: vi.fn() },
		payrollRunAccount: { count: vi.fn() },
		payrollRun: { count: vi.fn() },
	},
}))

import { db } from "~/lib/db.server"
import { loadNavCounts } from "./nav-counts.server"

describe("loadNavCounts", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: [],
		} as any)
	})

	it("gives a supervisor one count per queue, red for Review and Aviso", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(2) // review
			.mockResolvedValueOnce(5) // invoice
			.mockResolvedValueOnce(1) // aviso
			.mockResolvedValueOnce(14) // precert
			.mockResolvedValueOnce(31) // released
			.mockResolvedValueOnce(9) // all
		const counts = await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		expect(counts).toEqual({
			"/dashboard?stage=review": { value: 2, tone: "critical" },
			"/dashboard?stage=invoice": { value: 5, tone: "neutral" },
			"/dashboard?stage=aviso": { value: 1, tone: "critical" },
			"/dashboard?stage=precert": { value: 14, tone: "neutral" },
			"/dashboard?stage=released": { value: 31, tone: "neutral" },
			"/dashboard?stage=all": { value: 9, tone: "neutral" },
		})
		// Each count is scoped to the supervisor's own jobs and areas.
		expect(db.jafInvoice.count).toHaveBeenCalledWith({
			where: {
				AND: [
					expect.objectContaining({ OR: expect.any(Array) }),
					expect.objectContaining({ status: "FIELD_UPDATED" }),
				],
			},
		})
	})

	it("gives WAREHOUSE counts for prep, pickup, returns and material requests", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(4)
		vi.mocked(db.restockRequest.count).mockResolvedValue(1)
		expect(await loadNavCounts({ id: "w1", role: "WAREHOUSE" })).toEqual({
			"/dashboard#to-prep": { value: 3, tone: "neutral" },
			"/dashboard#awaiting-pickup": { value: 2, tone: "neutral" },
			"/dashboard#returns-due": { value: 4, tone: "neutral" },
			"/warehouse/restock#requests": { value: 1, tone: "neutral" },
		})
	})

	it("gives COMPTROLLER a count per payroll view, red for runs to pay", async () => {
		vi.mocked(db.payrollRun.count)
			.mockResolvedValueOnce(3) // to pay
			.mockResolvedValueOnce(7) // paid
		expect(await loadNavCounts({ id: "c1", role: "COMPTROLLER" })).toEqual({
			"/comptroller/lists": { value: 10, tone: "neutral" },
			"/comptroller/to-pay": { value: 3, tone: "critical" },
			"/comptroller/paid": { value: 7, tone: "neutral" },
		})
	})

	it("gives FINANCE one count per Arm A screen, critical when a run is overdue", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(4) // PACKETS
			.mockResolvedValueOnce(3) // LC_REQUEST
			.mockResolvedValueOnce(2) // LC_FUNDED
			.mockResolvedValueOnce(1) // LISTS
		vi.mocked(db.payrollRunAccount.count).mockResolvedValue(7)
		vi.mocked(db.payrollRun.count).mockResolvedValue(1)
		expect(await loadNavCounts({ id: "f1", role: "FINANCE" })).toEqual({
			"/finance/queue": { value: 4, tone: "neutral" },
			"/finance/lc-requests": { value: 3, tone: "neutral" },
			"/finance/lc-funded": { value: 2, tone: "neutral" },
			"/finance/payroll": { value: 1, tone: "neutral" },
			"/finance/awaiting-carmen": { value: 7, tone: "critical" },
		})
	})

	it("keeps the Carmen count neutral when no run is overdue", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		vi.mocked(db.payrollRunAccount.count).mockResolvedValue(2)
		vi.mocked(db.payrollRun.count).mockResolvedValue(0)
		const counts = await loadNavCounts({ id: "f1", role: "FINANCE" })
		expect(counts["/finance/awaiting-carmen"]).toEqual({
			value: 2,
			tone: "neutral",
		})
	})

	it("returns no counts for roles that do not define any yet", async () => {
		expect(await loadNavCounts({ id: "c1", role: "CREW" })).toEqual({})
		expect(db.jafInvoice.count).not.toHaveBeenCalled()
	})
})

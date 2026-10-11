import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUnique: vi.fn() },
		jafInvoice: { count: vi.fn() },
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

	it("gives a supervisor a critical dashboard count of submissions awaiting review", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(3)
		const counts = await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		expect(counts).toEqual({ "/dashboard": { value: 3, tone: "critical" } })
		expect(db.jafInvoice.count).toHaveBeenCalledWith({
			where: expect.objectContaining({
				status: "FIELD_UPDATED",
				OR: expect.any(Array),
			}),
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

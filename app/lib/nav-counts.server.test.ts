import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUnique: vi.fn() },
		jafInvoice: { count: vi.fn() },
		restockRequest: { count: vi.fn() },
		serialLocation: { count: vi.fn() },
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

	it("gives a supervisor a count per sidebar queue, red for Ready for pickup and Aviso", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(3) // open: PREPPED jobs
			.mockResolvedValueOnce(5) // invoice
			.mockResolvedValueOnce(1) // aviso
			.mockResolvedValueOnce(14) // precert
			.mockResolvedValueOnce(31) // released
			.mockResolvedValueOnce(9) // all
		const counts = await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		expect(counts).toEqual({
			"/dashboard?stage=open": { value: 3, tone: "critical" },
			"/dashboard?stage=invoice": { value: 5, tone: "neutral" },
			"/dashboard?stage=aviso": { value: 1, tone: "critical" },
			"/dashboard?stage=precert": { value: 14, tone: "neutral" },
			"/dashboard?stage=released": { value: 31, tone: "neutral" },
			"/dashboard?stage=all": { value: 9, tone: "neutral" },
		})
		// Review is hidden from the sidebar, so it is no longer counted.
		expect(counts).not.toHaveProperty("/dashboard?stage=review")
		// The open badge counts only Ready-for-pickup jobs, scoped to the
		// supervisor's own jobs and areas.
		expect(db.jafInvoice.count).toHaveBeenNthCalledWith(1, {
			where: {
				AND: [
					expect.objectContaining({ OR: expect.any(Array) }),
					{ status: "PREPPED", releasedToFinanceAt: null },
				],
			},
		})
	})

	it("the red Aviso count is the jobs sent to Claro still awaiting a saved Aviso", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		// Order: open, invoice, aviso, …
		expect(db.jafInvoice.count).toHaveBeenNthCalledWith(3, {
			where: {
				AND: [
					expect.objectContaining({ OR: expect.any(Array) }),
					{
						releasedToFinanceAt: null,
						// "Aviso saved" = number + stored PDF; either missing still counts.
						OR: [{ avisoNumber: null }, { avisoDocPath: null }],
						jafInvoiceGeneratedAt: { not: null },
						status: { not: "CANCELLED" },
					},
				],
			},
		})
	})

	it("gives WAREHOUSE counts per step page and for material requests", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(3) // prep
			.mockResolvedValueOnce(2) // release
			.mockResolvedValueOnce(4) // returns
		vi.mocked(db.restockRequest.count).mockResolvedValue(1)
		vi.mocked(db.serialLocation.count)
			.mockResolvedValueOnce(6) // repairs
			.mockResolvedValueOnce(2) // needs review
		expect(
			await loadNavCounts({ id: "w1", role: "WAREHOUSE" }, "wh-1"),
		).toEqual({
			"/warehouse/prep": { value: 3, tone: "neutral" },
			"/warehouse/release": { value: 2, tone: "neutral" },
			"/warehouse/returns": { value: 4, tone: "neutral" },
			"/warehouse/repairs": { value: 6, tone: "neutral" },
			"/warehouse/needs-review": { value: 2, tone: "neutral" },
			"/warehouse/requests": { value: 1, tone: "neutral" },
		})
	})

	it("scopes the repair and review counts to the selected warehouse", async () => {
		vi.mocked(db.serialLocation.count).mockResolvedValue(0)
		await loadNavCounts({ id: "w1", role: "WAREHOUSE" }, "wh-9")
		expect(db.serialLocation.count).toHaveBeenCalledWith({
			where: { status: "AWAITING_REPAIR", currentRef: "wh-9" },
		})
		expect(db.serialLocation.count).toHaveBeenCalledWith({
			where: { status: "NEEDS_REVIEW", currentRef: "wh-9" },
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
		expect(await loadNavCounts({ id: "i1", role: "INSTALLER" })).toEqual({})
		// Crew accounts no longer sign in.
		expect(await loadNavCounts({ id: "c1", role: "CREW" })).toEqual({})
		expect(db.jafInvoice.count).not.toHaveBeenCalled()
	})
})

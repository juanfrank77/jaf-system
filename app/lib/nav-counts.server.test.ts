import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUnique: vi.fn() },
		jafInvoice: { count: vi.fn(), findMany: vi.fn(async () => []) },
		restockRequest: { count: vi.fn() },
		brigadeRestock: { count: vi.fn(async () => 0) },
		brigadeStockReturn: { count: vi.fn(async () => 0) },
		serialLocation: { count: vi.fn() },
		payrollRunAccount: { count: vi.fn() },
		payrollRun: { count: vi.fn() },
		// The pay day setting (Carmen's overdue cutoff): unset, Thursday.
		systemSetting: { findUnique: vi.fn(async () => null) },
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

	it("gives a supervisor a count per sidebar queue, red for Ready for pickup, Returned and Aviso", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(3) // open: PREPPED jobs
			.mockResolvedValueOnce(2) // returned
			.mockResolvedValueOnce(5) // invoice
			.mockResolvedValueOnce(1) // aviso
			.mockResolvedValueOnce(14) // precert
			.mockResolvedValueOnce(31) // released
			.mockResolvedValueOnce(9) // all
		const counts = await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		expect(counts).toEqual({
			"/dashboard?stage=open": { value: 3, tone: "critical" },
			"/dashboard?stage=returned": { value: 2, tone: "critical" },
			"/dashboard?stage=invoice": { value: 5, tone: "neutral" },
			"/dashboard?stage=aviso": { value: 1, tone: "critical" },
			"/dashboard?stage=precert": { value: 14, tone: "neutral" },
			"/dashboard?stage=released": { value: 31, tone: "neutral" },
			"/dashboard?stage=all": { value: 9, tone: "neutral" },
			"/supervisor/stock": { value: 0, tone: "critical" },
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
		// Order: open, returned, invoice, aviso, …
		expect(db.jafInvoice.count).toHaveBeenNthCalledWith(4, {
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

	it("takes the returned packets out of Released to Finance and counts them under Returned", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValueOnce([
			{
				id: "back",
				releasedToFinanceAt: new Date(),
				financeVerifiedAt: null,
				pbccRequestSentAt: null,
				financeSendBackNotes: [{ note: "Fix", byUserId: "f", createdAt: "x" }],
			},
			{
				id: "resent",
				releasedToFinanceAt: new Date(),
				financeVerifiedAt: null,
				pbccRequestSentAt: null,
				financeSendBackNotes: [
					{ note: "Fix", byUserId: "f", createdAt: "x", resentAt: "y" },
				],
			},
		] as any)
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		const where = (n: number) =>
			(vi.mocked(db.jafInvoice.count).mock.calls[n - 1][0] as any).where.AND[1]
		// Order: open, returned, invoice, aviso, precert, released, all.
		expect(where(2)).toEqual({
			id: { in: ["back"] },
			status: { not: "CANCELLED" },
		})
		expect(where(6)).toMatchObject({
			releasedToFinanceAt: { not: null },
			id: { notIn: ["back"] },
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
			"/warehouse/brigade-stock": { value: 0, tone: "neutral" },
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

	it("gives FINANCE one count per Arm A screen, critical when a request is overdue", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(4) // PACKETS
			.mockResolvedValueOnce(3) // LC_REQUEST
			.mockResolvedValueOnce(1) // LISTS
		vi.mocked(db.payrollRunAccount.count).mockResolvedValue(7)
		vi.mocked(db.payrollRun.count).mockResolvedValue(1)
		expect(await loadNavCounts({ id: "f1", role: "FINANCE" })).toEqual({
			"/finance/queue": { value: 4, tone: "neutral" },
			"/finance/queue?stage=returned": { value: 0, tone: "neutral" },
			"/finance/lc-requests": { value: 3, tone: "neutral" },
			// Sold and ready for a request (1) plus brigades waiting on Carmen (7).
			"/finance/payroll": { value: 8, tone: "critical" },
		})
	})

	it("counts Lissette's returned packets in red and takes them out of Packets in", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValueOnce([
			{
				id: "back",
				releasedToFinanceAt: new Date(),
				financeVerifiedAt: null,
				pbccRequestSentAt: null,
				financeSendBackNotes: [{ note: "Fix", byUserId: "f", createdAt: "x" }],
			},
			{
				id: "resent",
				releasedToFinanceAt: new Date(),
				financeVerifiedAt: null,
				pbccRequestSentAt: null,
				financeSendBackNotes: [
					{ note: "Fix", byUserId: "f", createdAt: "x", resentAt: "y" },
				],
			},
		] as any)
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		const counts = await loadNavCounts({ id: "f1", role: "FINANCE" })
		expect(counts["/finance/queue?stage=returned"]).toEqual({
			value: 1,
			tone: "critical",
		})
		expect(vi.mocked(db.jafInvoice.count).mock.calls[0][0]).toMatchObject({
			where: { id: { notIn: ["back"] } },
		})
	})

	it("keeps the payroll count neutral when no request is overdue", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(0)
		vi.mocked(db.payrollRunAccount.count).mockResolvedValue(2)
		vi.mocked(db.payrollRun.count).mockResolvedValue(0)
		const counts = await loadNavCounts({ id: "f1", role: "FINANCE" })
		expect(counts["/finance/payroll"]).toEqual({
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

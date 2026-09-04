import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: { jafInvoice: { findMany: vi.fn() } },
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { loader } from "./_app.finance.queue"

describe("GET /finance/queue", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "fin-1", role: "FINANCE" },
			session: {},
		} as any)
	})

	it("lists released packets with contractor, amount and the Claro badge, plus the acceptance percentage", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([
			{
				id: "a",
				controlNumber: "MAINT-1",
				avisoNumber: "10353961",
				jafInvoiceLineTotal: "586.37",
				releasedToFinanceAt: new Date("2026-08-26"),
				contractorAccountCode: "204",
				brigade: { name: "JESUS MARTINEZ", leadName: "Jesús Martínez" },
				preCertSheets: [
					{
						sigSubcontractorName: "Jesús Martínez",
						sigClaroAt: null,
						sigClaroScanPath: null,
					},
				],
			},
			{
				id: "b",
				controlNumber: "MAINT-2",
				avisoNumber: "10352770",
				jafInvoiceLineTotal: "742.90",
				releasedToFinanceAt: new Date("2026-08-25"),
				contractorAccountCode: "041",
				brigade: { name: "BRIGADA 2", leadName: null },
				preCertSheets: [
					{
						sigSubcontractorName: null,
						sigClaroAt: new Date(),
						sigClaroScanPath: null,
					},
				],
			},
		] as any)
		const data = await loader({
			request: new Request("http://localhost/finance/queue"),
			params: {},
		} as any)
		expect(db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					releasedToFinanceAt: { not: null },
					status: { notIn: ["LC_REQUEST_GENERATED", "CANCELLED"] },
				},
			}),
		)
		expect(data.rows).toEqual([
			{
				id: "a",
				controlNumber: "MAINT-1",
				avisoNumber: "10353961",
				contractorName: "Jesús Martínez",
				contractorCode: "204",
				amount: 586.37,
				releasedAt: new Date("2026-08-26"),
				claroSigned: false,
			},
			{
				id: "b",
				controlNumber: "MAINT-2",
				avisoNumber: "10352770",
				contractorName: "BRIGADA 2",
				contractorCode: "041",
				amount: 742.9,
				releasedAt: new Date("2026-08-25"),
				claroSigned: true,
			},
		])
		expect(data.claroAcceptancePct).toBe(50)
	})

	it("returns null percentage when the queue is empty", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
		const data = await loader({
			request: new Request("http://localhost/finance/queue"),
			params: {},
		} as any)
		expect(data.rows).toEqual([])
		expect(data.claroAcceptancePct).toBeNull()
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		vanRestockRequest: {
			findMany: vi.fn(),
		},
		van: {
			findMany: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/van-stock.server", () => ({
	getVanParLevelsForVans: vi.fn(),
	parLevelsToStockLevels: vi.fn(
		(levels: { serviceCodeId: string; parLevel: number }[]) =>
			levels.map((l) => ({ serviceCodeId: l.serviceCodeId, qty: l.parLevel })),
	),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getVanParLevelsForVans } from "~/lib/van-stock.server"
import { loader } from "./_app.admin.restock"

describe("GET /admin/restock loader", () => {
	beforeEach(() => vi.clearAllMocks())

	it("batch-loads par levels via getVanParLevelsForVans", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findMany).mockResolvedValue([
			{
				id: "req-1",
				requestedById: "installer-1",
				items: [{ serviceCodeId: "sc-1", qty: 10 }],
				status: "PENDING_APPROVAL",
				createdAt: new Date(),
				requestedBy: { name: "Installer" },
				warehouse: { name: "Main" },
				approvedBy: null,
				approvalNote: null,
				deniedReason: null,
			},
		] as any)
		vi.mocked(db.van.findMany).mockResolvedValue([
			{ id: "van-1", installerId: "installer-1", name: "Van 1" },
		] as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([])
		vi.mocked(getVanParLevelsForVans).mockResolvedValue(
			new Map([["van-1", [{ serviceCodeId: "sc-1", parLevel: 5 }]]]),
		)

		const result = await loader({
			request: new Request("http://localhost/admin/restock"),
			params: {},
		} as any)

		expect(getVanParLevelsForVans).toHaveBeenCalledWith(["van-1"])
		expect(result.requests[0]?.exceeds).toBe(true)
		expect(result.requests[0]?.vanName).toBe("Van 1")
	})
})

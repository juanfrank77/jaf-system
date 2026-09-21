import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: {
			findUnique: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		vanInventoryTransaction: {
			findMany: vi.fn(),
		},
		vanRestockRequest: {
			findFirst: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/features.server", () => ({
	isInstallerV2Enabled: vi.fn(() => false),
}))

vi.mock("~/lib/van-stock.server", () => ({
	getVanParLevels: vi.fn(),
	parLevelsToStockLevels: vi.fn(
		(levels: { serviceCodeId: string; parLevel: number }[]) =>
			levels.map((l) => ({ serviceCodeId: l.serviceCodeId, qty: l.parLevel })),
	),
	computeParStatus: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { computeParStatus, getVanParLevels } from "~/lib/van-stock.server"
import { loader } from "./_app.installer.adjust"

describe("GET /installer/adjust loader", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseMocks() {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 444",
		} as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1", claroCode: "A", name: "Item A" },
			{ id: "sc-2", claroCode: "B", name: "Item B" },
		] as any)
		vi.mocked(db.vanRestockRequest.findFirst).mockResolvedValue(null)
	}

	it("loads par levels via getVanParLevels", async () => {
		baseMocks()
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
		] as any)
		vi.mocked(getVanParLevels).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		])
		vi.mocked(computeParStatus).mockReturnValue({
			hasParLevels: true,
			belowParCount: 1,
			belowParLines: [],
		})

		const result = await loader({
			request: new Request("http://localhost/installer/adjust"),
			params: {},
		} as any)

		expect(getVanParLevels).toHaveBeenCalledWith("van-1")
		expect(result.belowParCount).toBe(1)
		expect(result.parStatus.belowParCount).toBe(1)
	})

	it("returns hasParLevels false when no par rows exist", async () => {
		baseMocks()
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([])
		vi.mocked(getVanParLevels).mockResolvedValue([])
		vi.mocked(computeParStatus).mockReturnValue({
			hasParLevels: false,
			belowParCount: 0,
			belowParLines: [],
		})

		const result = await loader({
			request: new Request("http://localhost/installer/adjust"),
			params: {},
		} as any)

		expect(result.parStatus.hasParLevels).toBe(false)
		expect(result.belowParCount).toBe(0)
	})

	it("returns belowParCount zero when fully at par", async () => {
		baseMocks()
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 5, type: "RESTOCK" },
		] as any)
		vi.mocked(getVanParLevels).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		])
		vi.mocked(computeParStatus).mockReturnValue({
			hasParLevels: true,
			belowParCount: 0,
			belowParLines: [],
		})

		const result = await loader({
			request: new Request("http://localhost/installer/adjust"),
			params: {},
		} as any)

		expect(result.parStatus.hasParLevels).toBe(true)
		expect(result.belowParCount).toBe(0)
	})

	it("detects pending restock requests", async () => {
		baseMocks()
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([])
		vi.mocked(getVanParLevels).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		])
		vi.mocked(computeParStatus).mockReturnValue({
			hasParLevels: true,
			belowParCount: 1,
			belowParLines: [],
		})
		vi.mocked(db.vanRestockRequest.findFirst).mockResolvedValue({
			id: "req-1",
		} as any)

		const result = await loader({
			request: new Request("http://localhost/installer/adjust"),
			params: {},
		} as any)

		expect(result.hasPendingRestock).toBe(true)
	})
})

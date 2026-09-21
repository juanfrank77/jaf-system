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
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getVanParLevels } from "~/lib/van-stock.server"
import { loader } from "./_app.installer.adjust"

describe("GET /installer/adjust loader", () => {
	beforeEach(() => vi.clearAllMocks())

	it("loads par levels via getVanParLevels", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 1",
		} as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1", claroCode: "A", name: "Item A" },
		] as any)
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 2, type: "RESTOCK" },
		] as any)
		vi.mocked(getVanParLevels).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		])

		const result = await loader({
			request: new Request("http://localhost/installer/adjust"),
			params: {},
		} as any)

		expect(getVanParLevels).toHaveBeenCalledWith("van-1")
		expect(result.belowParCount).toBe(1)
	})
})

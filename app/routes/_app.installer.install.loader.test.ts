import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: { findUnique: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		vanInventoryTransaction: { findMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/features.server", () => ({
	isInstallerV2Enabled: vi.fn(),
}))

vi.mock("~/lib/van-stock.server", () => ({
	getVanParLevels: vi.fn(),
	parLevelsToStockLevels: vi.fn(
		(levels: { serviceCodeId: string; parLevel: number }[]) =>
			levels.map((l) => ({ serviceCodeId: l.serviceCodeId, qty: l.parLevel })),
	),
}))

import { db } from "~/lib/db.server"
import { isInstallerV2Enabled } from "~/lib/features.server"
import { requireRole } from "~/lib/permissions.server"
import { getVanParLevels } from "~/lib/van-stock.server"
import { loader } from "./_app.installer.install"

describe("GET /installer/install loader", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns v2 inventory comparison for on-hand context", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(isInstallerV2Enabled).mockReturnValue(true)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 444",
		} as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1", claroCode: "111", name: "Cable" },
		] as any)
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 4, type: "RESTOCK" },
		] as any)
		vi.mocked(getVanParLevels).mockResolvedValue([
			{ serviceCodeId: "sc-1", parLevel: 5 },
		])

		const data = await loader({
			request: new Request("http://localhost/installer/install"),
			params: {},
		} as any)

		expect(data.version).toBe("v2")
		expect(data.comparison).toEqual([
			expect.objectContaining({
				serviceCodeId: "sc-1",
				onHand: 4,
				claroCode: "111",
			}),
		])
	})
})

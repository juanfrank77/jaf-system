import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: { findUnique: vi.fn() },
		warehouse: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		vanInventoryTransaction: { findMany: vi.fn() },
		vanRestockRequest: { findMany: vi.fn(), findFirst: vi.fn() },
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
	computeParStatus: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { isInstallerV2Enabled } from "~/lib/features.server"
import { requireRole } from "~/lib/permissions.server"
import { computeParStatus, getVanParLevels } from "~/lib/van-stock.server"
import { loader } from "./_app.installer.restock"

describe("GET /installer/restock loader", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns v2 inventory context with below-par and pending request counts", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(isInstallerV2Enabled).mockReturnValue(true)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 444",
		} as any)
		vi.mocked(db.warehouse.findMany).mockResolvedValue([
			{ id: "wh-1", name: "Guaynabo" },
		] as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1", claroCode: "111", name: "Cable" },
		] as any)
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
		vi.mocked(db.vanRestockRequest.findMany).mockResolvedValue([
			{ id: "req-1", status: "REQUESTED", warehouse: { name: "Guaynabo" } },
		] as any)
		vi.mocked(db.vanRestockRequest.findFirst).mockResolvedValue({
			id: "req-1",
		} as any)

		const data = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as any)

		expect(data.version).toBe("v2")
		expect(data.parStatus.belowParCount).toBe(1)
		expect(data.pendingRequestCount).toBe(1)
		expect(data.hasPendingRestock).toBe(true)
		expect(data.comparison).toHaveLength(1)
	})

	it("returns v1 when installer v2 flag is off", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(isInstallerV2Enabled).mockReturnValue(false)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 444",
		} as any)
		vi.mocked(db.warehouse.findMany).mockResolvedValue([])
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([])
		vi.mocked(db.vanInventoryTransaction.findMany).mockResolvedValue([])
		vi.mocked(getVanParLevels).mockResolvedValue([])
		vi.mocked(computeParStatus).mockReturnValue({
			hasParLevels: false,
			belowParCount: 0,
			belowParLines: [],
		})
		vi.mocked(db.vanRestockRequest.findMany).mockResolvedValue([])
		vi.mocked(db.vanRestockRequest.findFirst).mockResolvedValue(null)

		const data = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as any)

		expect(data.version).toBe("v1")
		expect(data.hasPendingRestock).toBe(false)
		expect(data.pendingRequestCount).toBe(0)
	})
})

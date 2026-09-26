import { beforeEach, describe, expect, it, vi } from "vitest"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	db: {
		restockRequest: { findMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.warehouse.restock"

describe("GET /warehouse/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("gates the loader via canReleaseToVan, not a separately hardcoded role list", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		await loader({
			request: new Request("http://localhost/warehouse/restock"),
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(
			expect.anything(),
			rolesMatching(canReleaseToVan),
		)
	})

	it("only lists SUBMITTED/APPROVED restocks", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		await loader({
			request: new Request("http://localhost/warehouse/restock"),
		} as never)
		expect(mocks.db.restockRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { status: { in: ["SUBMITTED", "APPROVED"] } },
			}),
		)
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	db: { restockRequest: { findMany: vi.fn() } },
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.warehouse.requests"

describe("GET /warehouse/requests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
	})

	it("gates the loader via canReleaseToVan", async () => {
		await loader({
			request: new Request("http://localhost/warehouse/requests"),
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(
			expect.anything(),
			rolesMatching(canReleaseToVan),
		)
	})

	it("lists every submitted request, not just the pending ones", async () => {
		await loader({
			request: new Request("http://localhost/warehouse/requests"),
		} as never)
		expect(mocks.db.restockRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { status: { not: "DRAFT" } },
				orderBy: { submittedAt: "desc" },
			}),
		)
	})
})

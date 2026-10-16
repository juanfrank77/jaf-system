import { beforeEach, describe, expect, it, vi } from "vitest"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	db: { restockRequest: { findMany: vi.fn(), count: vi.fn() } },
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.warehouse.requests"

describe("GET /warehouse/requests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		mocks.db.restockRequest.count.mockResolvedValue(0)
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
				orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
			}),
		)
	})

	it("pages the list and clamps a page past the end", async () => {
		mocks.db.restockRequest.count.mockResolvedValue(45)
		const data = await loader({
			request: new Request("http://localhost/warehouse/requests?page=99"),
		} as never)
		expect(data.paging).toMatchObject({ page: 3, pageCount: 3, total: 45 })
		expect(mocks.db.restockRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 40, take: 20 }),
		)
	})
})

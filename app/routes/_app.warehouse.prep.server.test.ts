import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	db: { jafInvoice: { findMany: vi.fn() } },
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.warehouse.prep"

const call = () =>
	loader({ request: new Request("http://localhost/warehouse/prep") } as never)

describe("GET /warehouse/prep", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.db.jafInvoice.findMany.mockResolvedValue([])
	})

	it("is open to the warehouse and admin only", async () => {
		await call()
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"WAREHOUSE",
			"ADMIN",
		])
	})

	it("lists CREATED jobs and, separately, the missing-materials flags", async () => {
		await call()
		expect(mocks.db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { status: "CREATED" }, take: 50 }),
		)
		expect(mocks.db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					status: { in: ["CREATED", "PREPPED"] },
					prepChangedSincePrep: true,
				},
			}),
		)
	})

	it("redirects other roles", async () => {
		mocks.requireRole.mockRejectedValue(
			new Response(null, { status: 302, headers: { Location: "/dashboard" } }),
		)
		await expect(call()).rejects.toThrow()
	})
})

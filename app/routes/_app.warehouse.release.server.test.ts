import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	db: { jafInvoice: { findMany: vi.fn() } },
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.warehouse.release"

const call = () =>
	loader({
		request: new Request("http://localhost/warehouse/release"),
	} as never)

describe("GET /warehouse/release", () => {
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

	it("lists PREPPED jobs", async () => {
		await call()
		expect(mocks.db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { status: "PREPPED" } }),
		)
	})

	it("a doc with no preppedAt still lists with daysStaged: 0, aged: false", async () => {
		mocks.db.jafInvoice.findMany.mockResolvedValue([
			{ id: "d1", preppedAt: null },
		])
		const result = await call()
		expect(result.docs[0]).toMatchObject({ daysStaged: 0, aged: false })
	})

	it("redirects other roles", async () => {
		mocks.requireRole.mockRejectedValue(
			new Response(null, { status: 302, headers: { Location: "/dashboard" } }),
		)
		await expect(call()).rejects.toThrow()
	})
})

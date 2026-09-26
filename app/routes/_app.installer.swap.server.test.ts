import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	db: {
		installCompletion: { findMany: vi.fn() },
	},
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.installer.swap"

describe("GET /installer/swap", () => {
	beforeEach(() => vi.clearAllMocks())

	it("scopes the search to the requesting installer's own completions", async () => {
		mocks.requireInstaller.mockResolvedValue({ user: { id: "inst-1" } })
		mocks.db.installCompletion.findMany.mockResolvedValue([])

		await loader({
			request: new Request("http://localhost/installer/swap?q=430920"),
			params: {},
		} as never)

		expect(mocks.db.installCompletion.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ installerId: "inst-1" }),
			}),
		)
	})
})

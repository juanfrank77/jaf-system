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
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1", name: "Alfredo" },
		})
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

	it("returns the serial, install date, day count and installer name", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1", name: "Alfredo R." },
		})
		const installed = new Date(Date.now() - 22 * 86_400_000 - 3_600_000)
		mocks.db.installCompletion.findMany.mockResolvedValue([
			{
				id: "c1",
				claroOrderNo: "429960",
				address: "Bo. Cedro Arriba, Naranjito",
				serialInstalled: "ALCLED1A6042",
				installedAt: installed,
				createdAt: new Date(),
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/swap?q=429960"),
			params: {},
		} as never)
		expect(res.installerName).toBe("Alfredo R.")
		expect(res.results[0]).toMatchObject({
			id: "c1",
			serialInstalled: "ALCLED1A6042",
			installedAt: installed.toISOString(),
			daysSince: 22,
		})
	})

	it("falls back to the submit date when installedAt is missing", async () => {
		mocks.requireInstaller.mockResolvedValue({ user: { id: "i", name: "A" } })
		const created = new Date(Date.now() - 2 * 86_400_000 - 3_600_000)
		mocks.db.installCompletion.findMany.mockResolvedValue([
			{
				id: "c2",
				claroOrderNo: "1",
				address: "a",
				serialInstalled: null,
				installedAt: null,
				createdAt: created,
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/swap?q=1"),
			params: {},
		} as never)
		expect(res.results[0].daysSince).toBe(2)
		expect(res.results[0].serialInstalled).toBeNull()
	})
})

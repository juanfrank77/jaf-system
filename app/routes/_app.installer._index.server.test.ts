import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	getVanView: vi.fn(),
	db: {
		paymentRequest: { findMany: vi.fn() },
		installCompletion: { findMany: vi.fn() },
	},
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/van-view.server", () => ({ getVanView: mocks.getVanView }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { loader } from "./_app.installer._index"

describe("GET /installer", () => {
	beforeEach(() => vi.clearAllMocks())

	it("lists submitted jobs with a status pill", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1", name: "Installer" },
			van: { id: "van-1" },
		})
		mocks.db.paymentRequest.findMany.mockResolvedValue([
			{
				id: "pr1",
				kind: "INSTALL",
				status: "READY",
				completionId: "c1",
				createdAt: new Date("2026-10-01T12:00:00Z"),
			},
		])
		mocks.db.installCompletion.findMany.mockResolvedValue([
			{ id: "c1", claroOrderNo: "430920" },
		])
		mocks.getVanView.mockResolvedValue({
			serialized: [],
			accessories: [],
			owedBack: [],
		})

		const req = new Request("http://localhost/installer")
		const res = await loader({ request: req, params: {}, context: {} } as never)
		expect(res.jobs[0].pill).toBe("READY")
		expect(res.jobs[0].claroOrderNo).toBe("430920")
		expect(res.jobs[0].submittedAt).toBe("2026-10-01T12:00:00.000Z")
	})
})

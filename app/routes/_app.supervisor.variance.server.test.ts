import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findMany: vi.fn(() => Promise.resolve([])) },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/supervisor-scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/supervisor-scope")>()
	return {
		...actual,
		supervisorAreas: vi.fn(),
		// Wrap the real ownedOrInArea (not a hand-rolled copy) so this test
		// still fails if the real predicate's shape ever changes.
		ownedOrInArea: vi.fn(actual.ownedOrInArea),
	}
})

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ownedOrInArea, supervisorAreas } from "~/lib/supervisor-scope"
import { loader } from "./_app.supervisor.variance"

describe("GET /supervisor/variance", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubEnv("ENABLE_VARIANCE", "true")
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
	})

	it("404s when ENABLE_VARIANCE is off", async () => {
		vi.stubEnv("ENABLE_VARIANCE", "false")
		await expect(
			loader({
				request: new Request("http://localhost/supervisor/variance"),
				params: {},
			} as any),
		).rejects.toMatchObject({ init: { status: 404 } })
	})

	it("caps the query at take: 100 and scopes it via the shared ownedOrInArea helper", async () => {
		await loader({
			request: new Request("http://localhost/supervisor/variance"),
			params: {},
		} as any)

		expect(db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 100 }),
		)
		expect(ownedOrInArea).toHaveBeenCalledWith("sup-1", ["CENTRAL"])
	})

	it("does not crash computing material signals from doc rows lacking status/date fields", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([
			{
				id: "doc-1",
				controlNumber: "JAF-1",
				estimatedMaterials: [{ serviceCodeId: "c1", qty: 5 }],
				materialsTaken: [{ serviceCodeId: "c1", qty: 10 }],
				materialsUsed: [],
				materialsReturned: null,
				brigade: { name: "Brigada A" },
			},
		] as any)

		const result = await loader({
			request: new Request("http://localhost/supervisor/variance"),
			params: {},
		} as any)

		expect(result.rows).toHaveLength(1)
		expect(result.rows[0].kinds).toContain("overage")
	})
})

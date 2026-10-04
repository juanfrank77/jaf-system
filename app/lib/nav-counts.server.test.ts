import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUnique: vi.fn() },
		jafInvoice: { count: vi.fn() },
	},
}))

import { db } from "~/lib/db.server"
import { loadNavCounts } from "./nav-counts.server"

describe("loadNavCounts", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: [],
		} as any)
	})

	it("gives a supervisor a critical dashboard count of submissions awaiting review", async () => {
		vi.mocked(db.jafInvoice.count).mockResolvedValue(3)
		const counts = await loadNavCounts({ id: "sup-1", role: "SUPERVISOR" })
		expect(counts).toEqual({ "/dashboard": { value: 3, tone: "critical" } })
		expect(db.jafInvoice.count).toHaveBeenCalledWith({
			where: expect.objectContaining({ status: "FIELD_UPDATED" }),
		})
	})

	it("returns no counts for roles that do not define any yet", async () => {
		expect(await loadNavCounts({ id: "c1", role: "CREW" })).toEqual({})
		expect(db.jafInvoice.count).not.toHaveBeenCalled()
	})
})

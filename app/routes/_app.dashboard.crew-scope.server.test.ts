import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		installerProfile: { findUnique: vi.fn() },
		user: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
		jafInvoice: { findMany: vi.fn() },
		preCertSheet: { findMany: vi.fn() },
		$queryRaw: vi.fn(),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/features.server", () => ({
	isDashboardFiltersEnabled: vi.fn().mockReturnValue(false),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const args = (qs = "") =>
	({ request: new Request(`http://x/dashboard${qs}`) }) as any

describe("GET /dashboard (CREW)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "c1" } } as any)
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "c1",
			role: "CREW",
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findMany).mockResolvedValue([])
		vi.mocked(db.$queryRaw).mockResolvedValue([])
	})

	it("scopes every job query to jobs the member is assigned to", async () => {
		await loader(args())
		// Lead or not, a member lands in assignedCrewIds, so one `has` covers both.
		const jobQueries = vi
			.mocked(db.jafInvoice.findMany)
			.mock.calls.filter(([a]) => a?.where)
		expect(jobQueries.length).toBeGreaterThan(0)
		for (const [a] of jobQueries) {
			expect(a?.where).toMatchObject({ assignedCrewIds: { has: "c1" } })
		}
		for (const [, ...values] of vi.mocked(db.$queryRaw).mock.calls) {
			expect(values).toContain("c1")
		}
	})

	it("keeps the scope when a stage queue is selected", async () => {
		const data = (await loader(args("?stage=field"))) as any
		expect(data.crewQueue).toBe("field")
		const jobQueries = vi
			.mocked(db.jafInvoice.findMany)
			.mock.calls.filter(([a]) => a?.where)
		for (const [a] of jobQueries) {
			expect(a?.where).toMatchObject({ assignedCrewIds: { has: "c1" } })
		}
	})

	it("ignores supervisor-only stages", async () => {
		const data = (await loader(args("?stage=released"))) as any
		expect(data.crewQueue).toBeNull()
	})
})

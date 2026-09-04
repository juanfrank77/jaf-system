import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
		jafInvoice: { findMany: vi.fn() },
		vanRestockRequest: { findMany: vi.fn() },
		preCertSheet: { findMany: vi.fn() },
		$queryRaw: vi.fn(),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/system-settings.server", () => ({
	getAvisoAmountTolerance: vi.fn().mockResolvedValue(0.01),
}))
vi.mock("~/lib/features.server", () => ({
	isComptrollerEnabled: () => false,
	isDashboardFiltersEnabled: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { isDashboardFiltersEnabled } from "~/lib/features.server"
import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const sup = { id: "sup-1", role: "SUPERVISOR" }
const row = (o: Record<string, unknown>) => ({
	id: "x",
	controlNumber: "C",
	status: "SUPERVISOR_APPROVED",
	jobType: "M",
	jobAddressEstimated: "A",
	jobAddressActual: null,
	createdAt: new Date(),
	supervisorApprovedAt: new Date(),
	jafInvoiceGeneratedAt: null,
	jafInvoiceLineTotal: null,
	avisoLineTotal: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
	brigade: { name: "JESUS MARTINEZ" },
	sendBackHistory: null,
	...o,
})

describe("GET /dashboard (SUPERVISOR)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "sup-1" },
		} as any)
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(sup as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.$queryRaw).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findMany).mockResolvedValue([])
		vi.mocked(isDashboardFiltersEnabled).mockReturnValue(false)
	})

	it("returns the four queues and no stats", async () => {
		vi.mocked(db.jafInvoice.findMany)
			.mockResolvedValueOnce([]) // jobTypeOptions
			.mockResolvedValueOnce([]) // docs list
			.mockResolvedValueOnce([
				row({ id: "p", status: "FIELD_UPDATED", supervisorApprovedAt: null }),
			] as any) // pending review
			.mockResolvedValueOnce([
				row({ id: "m", jafInvoiceGeneratedAt: new Date() }),
			] as any) // approved candidates
		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)
		expect(data.stats).toEqual([])
		expect(data.showFilters).toBe(false)
		expect(data.supervisorQueues!.pendingReview.map((r) => r.id)).toEqual(["p"])
		expect(data.supervisorQueues!.missingAviso.map((r) => r.id)).toEqual(["m"])
		expect(data.supervisorQueues!.missingAviso[0]).toMatchObject({
			brigadeName: "JESUS MARTINEZ",
			stage: "AVISO",
		})
	})

	it("puts a job with a stored mismatch into the blocked queue, not the missing-aviso queue", async () => {
		vi.mocked(db.jafInvoice.findMany)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([
				row({
					id: "b",
					jafInvoiceGeneratedAt: new Date(),
					jafInvoiceLineTotal: 586.37,
					avisoLineTotal: 11623.28,
				}),
				row({
					id: "ok",
					jafInvoiceGeneratedAt: new Date(),
					jafInvoiceLineTotal: 586.37,
					avisoLineTotal: 586.37,
					avisoMatchedAt: new Date(),
				}),
			] as any)
		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)
		expect(data.supervisorQueues!.blocked.map((r) => r.id)).toEqual(["b"])
		expect(data.supervisorQueues!.missingAviso).toEqual([])
	})

	it("exposes showFilters when the flag is on", async () => {
		vi.mocked(isDashboardFiltersEnabled).mockReturnValue(true)
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)
		expect(data.showFilters).toBe(true)
	})
})

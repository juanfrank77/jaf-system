import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		installerProfile: { findUnique: vi.fn() },
		user: {
			findUniqueOrThrow: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
		},
		jafInvoice: { findMany: vi.fn(), count: vi.fn() },
		brigade: { findMany: vi.fn(), count: vi.fn() },
		preCertSheet: { findMany: vi.fn() },
		warehouseAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
		warehouse: { findMany: vi.fn() },
		$queryRaw: vi.fn(),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/system-settings.server", () => ({
	getAvisoAmountTolerance: vi.fn().mockResolvedValue(0.01),
}))
vi.mock("~/lib/features.server", () => ({
	isDashboardFiltersEnabled: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { isDashboardFiltersEnabled } from "~/lib/features.server"
import { requireSession } from "~/lib/permissions.server"
import { getAvisoAmountTolerance } from "~/lib/system-settings.server"
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
	avisoNumber: null,
	avisoDocPath: null,
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
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: [],
		} as any)
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		vi.mocked(db.brigade.count).mockResolvedValue(0)
		vi.mocked(db.$queryRaw).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findMany).mockResolvedValue([])
		vi.mocked(isDashboardFiltersEnabled).mockReturnValue(false)
	})

	it("returns the four queues alongside the stat tiles", async () => {
		vi.mocked(db.jafInvoice.findMany)
			.mockResolvedValueOnce([]) // jobTypeOptions
			.mockResolvedValueOnce([]) // docs list
			.mockResolvedValueOnce([
				row({ id: "n", status: "CREATED", createdAt: new Date() }),
			] as any) // intake
			.mockResolvedValueOnce([
				row({ id: "p", status: "FIELD_UPDATED", supervisorApprovedAt: null }),
			] as any) // pending review
			.mockResolvedValueOnce([
				row({ id: "m", jafInvoiceGeneratedAt: new Date() }),
			] as any) // approved candidates
			.mockResolvedValueOnce([
				row({ id: "p", status: "FIELD_UPDATED", supervisorApprovedAt: null }),
				row({ id: "m", jafInvoiceGeneratedAt: new Date() }),
			] as any) // my open work orders
		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)
		expect(data.stats).toHaveLength(12)
		expect(data.showFilters).toBe(false)
		expect(data.supervisorQueues!.intake.map((r) => r.id)).toEqual(["n"])
		expect(data.supervisorQueues!.myOpen).toEqual([
			expect.objectContaining({ id: "p", stage: "APPROVE", waitingOn: "you" }),
			expect.objectContaining({ id: "m", stage: "AVISO", waitingOn: "you" }),
		])
		expect(data.supervisorQueues!.intake[0]).toMatchObject({ stage: "INTAKE" })
		expect(data.supervisorQueues!.pendingReview.map((r) => r.id)).toEqual(["p"])
		expect(data.supervisorQueues!.missingAviso.map((r) => r.id)).toEqual(["m"])
		expect(data.supervisorQueues!.missingAviso[0]).toMatchObject({
			brigadeName: "JESUS MARTINEZ",
			stage: "AVISO",
		})
	})

	it("never blocks a job on amounts: a legacy stored Aviso total is ignored", async () => {
		vi.mocked(db.jafInvoice.findMany)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([] as any) // intake
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
					avisoNumber: "10353961",
					avisoDocPath: "aviso-docs/ok-aviso.pdf",
				}),
			] as any)
			.mockResolvedValueOnce([] as any) // my open work orders
		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)
		expect(data.supervisorQueues!.missingAviso.map((r) => r.id)).toEqual(["b"])
		expect(data.supervisorQueues!.approved.map((r) => r.id)).toEqual(["ok"])
		expect(getAvisoAmountTolerance).not.toHaveBeenCalled()
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

// The dashboard hands the Warehouse the same `warehouseCounts` the queue pages
// and sidebar pills use (countWarehouseQueues from warehouse-queues.server).
describe("GET /dashboard (WAREHOUSE) — count cards", () => {
	const wh = { id: "wh-user", role: "WAREHOUSE" }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "wh-user" },
		} as any)
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(wh as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.$queryRaw).mockResolvedValue([])
		vi.mocked(db.warehouseAssignment.findMany).mockResolvedValue([] as any)
		vi.mocked(db.warehouse.findMany).mockResolvedValue([] as any)
		vi.mocked(isDashboardFiltersEnabled).mockReturnValue(false)
	})

	it("exposes warehouseCounts on the loader data", async () => {
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([] as any)
		vi.mocked(db.jafInvoice.count).mockResolvedValue(5)

		const data = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any)

		expect(data.warehouseCounts).toMatchObject({
			prep: 5,
			release: 5,
			returns: 5,
		})
	})

	describe("installer landing", () => {
		function args() {
			return {
				request: new Request("http://localhost/dashboard"),
				params: {},
			} as never
		}

		it("sends an installer with a profile to /installer", async () => {
			vi.mocked(requireSession).mockResolvedValue({
				user: { id: "inst-1" },
			} as never)
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "inst-1",
				role: "INSTALLER",
			} as never)
			vi.mocked(db.installerProfile.findUnique).mockResolvedValue({
				id: "p1",
			} as never)
			const thrown = await loader(args()).catch((r: Response) => r)
			expect((thrown as Response).status).toBe(302)
			expect((thrown as Response).headers.get("Location")).toBe("/installer")
		})

		it("does not redirect an installer without a profile (that would loop)", async () => {
			vi.mocked(requireSession).mockResolvedValue({
				user: { id: "inst-2" },
			} as never)
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "inst-2",
				role: "INSTALLER",
			} as never)
			vi.mocked(db.installerProfile.findUnique).mockResolvedValue(null as never)
			vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
			vi.mocked(db.user.findMany).mockResolvedValue([])
			const res = await loader(args()).catch((r: unknown) => r)
			expect(res instanceof Response).toBe(false)
		})

		it.each(["SUPERVISOR"])(
			"never redirects %s to /installer",
			async (role) => {
				vi.mocked(requireSession).mockResolvedValue({
					user: { id: "u" },
				} as never)
				vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
					id: "u",
					role,
				} as never)
				vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
				vi.mocked(db.user.findMany).mockResolvedValue([])
				const res = await loader(args()).catch((r: unknown) => r)
				const loc =
					res instanceof Response ? res.headers.get("Location") : undefined
				expect(loc).not.toBe("/installer")
				expect(db.installerProfile.findUnique).not.toHaveBeenCalled()
			},
		)
	})
})

describe("GET /dashboard (COMPTROLLER)", () => {
	it("redirects to /comptroller", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "comp-1" },
		} as any)
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "comp-1",
			role: "COMPTROLLER",
		} as any)
		const thrown = await loader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as any).then(
			() => null,
			(e: unknown) => e,
		)
		expect(thrown).toBeInstanceOf(Response)
		expect((thrown as Response).headers.get("Location")).toBe("/comptroller")
	})
})

describe("GET /dashboard (CREW)", () => {
	it("sends the crew member to the crew notice and loads no jobs", async () => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({ user: { id: "c1" } } as any)
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "c1",
			role: "CREW",
		} as any)
		const thrown = await loader({
			request: new Request("http://localhost/dashboard?stage=field"),
			params: {},
		} as any).then(
			() => null,
			(e: unknown) => e,
		)
		expect(thrown).toBeInstanceOf(Response)
		expect((thrown as Response).headers.get("Location")).toBe("/crew-notice")
		expect(db.jafInvoice.findMany).not.toHaveBeenCalled()
		expect(db.$queryRaw).not.toHaveBeenCalled()
	})
})

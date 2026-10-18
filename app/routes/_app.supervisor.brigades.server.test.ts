import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findMany: vi.fn() },
		jafInvoice: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/supervisor-scope", () => ({ supervisorAreas: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { supervisorAreas } from "~/lib/supervisor-scope"
import * as route from "./_app.supervisor.brigades"

const load = () =>
	route.loader({
		request: new Request("http://localhost/supervisor/brigades"),
		params: {},
	} as any) as Promise<any>

const job = (o: Record<string, unknown>) => ({
	id: "j",
	controlNumber: "JAF-1",
	status: "SIGNED",
	jobAddressEstimated: "Calle 1",
	jobAddressActual: null,
	brigadeId: "b1",
	crewAssignmentHistory: null,
	supervisorApprovedAt: null,
	jafInvoiceGeneratedAt: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
	...o,
})

describe("GET /supervisor/brigades (read-only)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
	})

	it("offers no way to change a brigade", () => {
		expect("action" in route).toBe(false)
	})

	it("lists only active brigades in the supervisor's own areas", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		await load()
		expect(db.brigade.findMany).toHaveBeenCalledWith({
			where: { active: true, area: { in: ["CENTRAL"] } },
			orderBy: { name: "asc" },
		})
		expect(db.jafInvoice.findMany).not.toHaveBeenCalled()
	})

	it("lists one row per job with its stage, and only idle brigades as available", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "UNO", area: "CENTRAL", memberIds: ["c1"] },
			{ id: "b2", name: "DOS", area: "CENTRAL", memberIds: [] },
		] as any)
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([
			job({ id: "j1", status: "SIGNED" }),
			job({
				id: "j2",
				status: "FIELD_UPDATED",
				controlNumber: "JAF-2",
				jobAddressActual: "Calle 2",
			}),
		] as any)
		const { jobs, available } = await load()
		expect(jobs).toEqual([
			{
				id: "j1",
				controlNumber: "JAF-1",
				address: "Calle 1",
				stage: "FIELD",
				brigades: ["UNO"],
			},
			{
				id: "j2",
				controlNumber: "JAF-2",
				address: "Calle 2",
				stage: "APPROVE",
				brigades: ["UNO"],
			},
		])
		expect(available).toEqual([{ id: "b2", name: "DOS", area: "CENTRAL" }])
	})

	it("shows a shared job once, naming every brigade on it, and none of them as available", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "UNO", area: "CENTRAL", memberIds: ["c1"] },
			{ id: "b2", name: "DOS", area: "CENTRAL", memberIds: ["c2"] },
		] as any)
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([
			job({
				brigadeId: "b1",
				crewAssignmentHistory: [{ brigadeIds: ["b1", "b2"] }],
			}),
		] as any)
		const { jobs, available } = await load()
		expect(jobs).toHaveLength(1)
		expect(jobs[0].brigades).toEqual(["UNO", "DOS"])
		expect(available).toEqual([])
	})

	it("drops a job that is only assigned to brigades outside the supervisor's areas", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "UNO", area: "CENTRAL", memberIds: ["c1"] },
		] as any)
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([
			job({ brigadeId: "other" }),
		] as any)
		const { jobs, available } = await load()
		expect(jobs).toEqual([])
		expect(available).toHaveLength(1)
	})

	it("only counts jobs a brigade still has work on", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", name: "UNO", area: "CENTRAL", memberIds: [] },
		] as any)
		vi.mocked(db.jafInvoice.findMany).mockResolvedValue([])
		await load()
		expect(db.jafInvoice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					status: { in: ["CREATED", "PREPPED", "SIGNED", "FIELD_UPDATED"] },
				}),
			}),
		)
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findMany: vi.fn() },
		jafInvoice: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/brigade-standby.server", () => ({ standByBrigade: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/supervisor-scope", () => ({ supervisorAreas: vi.fn() }))

import { standByBrigade } from "~/lib/brigade-standby.server"
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
	avisoNumber: null,
	avisoDocPath: null,
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

	it("lists active, non-equipment, non-terminated brigades in my areas or under me", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		await load()
		expect(db.brigade.findMany).toHaveBeenCalledWith({
			where: {
				active: true,
				isEquipmentAccount: false,
				terminatedAt: null,
				// An activated imported brigade has no area: it is mine by owner.
				OR: [{ supervisorId: "sup-1" }, { area: { in: ["CENTRAL"] } }],
			},
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

describe("POST /supervisor/brigades (stand-by)", () => {
	const post = (fields: Record<string, string>) =>
		route.action({
			request: new Request("http://localhost/supervisor/brigades", {
				method: "POST",
				body: new URLSearchParams(fields),
			}),
			params: {},
		} as any) as Promise<any>

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
	})

	it("requires the SUPERVISOR role", async () => {
		vi.mocked(requireRole).mockRejectedValue(
			new Response(null, { status: 302 }),
		)
		await expect(
			post({ intent: "standby", brigadeId: "b1" }),
		).rejects.toBeInstanceOf(Response)
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), ["SUPERVISOR"])
		expect(standByBrigade).not.toHaveBeenCalled()
	})

	it("stands the brigade by for the signed-in supervisor", async () => {
		vi.mocked(standByBrigade).mockResolvedValue({ ok: true })
		expect(await post({ intent: "standby", brigadeId: "b1" })).toEqual({
			ok: true,
		})
		expect(standByBrigade).toHaveBeenCalledWith(db, {
			brigadeId: "b1",
			viewerId: "sup-1",
		})
	})

	it("returns the refusal key", async () => {
		vi.mocked(standByBrigade).mockResolvedValue({
			ok: false,
			errorKey: "supervisor_brigades.errors.on_a_job",
		})
		expect(await post({ intent: "standby", brigadeId: "b1" })).toEqual({
			errorKey: "supervisor_brigades.errors.on_a_job",
		})
	})

	it("ignores an unknown intent", async () => {
		expect(await post({ intent: "nope", brigadeId: "b1" })).toEqual({
			errorKey: "supervisor_brigades.errors.not_found",
		})
		expect(standByBrigade).not.toHaveBeenCalled()
	})
})

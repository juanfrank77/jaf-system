import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
	jafInvoice: { update: vi.fn() },
	auditTrail: { create: vi.fn() },
	user: { findMany: vi.fn() },
	notification: { create: vi.fn() },
}))
vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		auditTrail: { create: vi.fn() },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		brigade: { findMany: vi.fn(), findUnique: vi.fn() },
		serviceCode: { findMany: vi.fn(() => Promise.resolve([])) },
		$transaction: vi.fn(async (fn: any) => fn(tx)),
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/service-codes.server", () => ({
	getActiveMaterialCodes: vi.fn(() => Promise.resolve([])),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.edit"

function baseDoc(overrides: Record<string, unknown> = {}) {
	return {
		id: "doc-1",
		controlNumber: "JAF-1001",
		status: "CREATED",
		supervisorId: "other-sup",
		brigadeId: "b1",
		brigade: { area: "SUR" },
		estimatedMaterials: [],
		serviceLines: [],
		avisoNumber: null,
		...overrides,
	}
}

describe("GET /docs/:id/edit — supervisor scope", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
			session: {},
		} as any)
	})

	it("blocks a Supervisor from loading the edit form for a doc outside their area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)

		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1/edit"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("allows a Supervisor to load the edit form for a doc in their brigade's area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.id).toBe("doc-1")
	})
})

describe("POST /docs/:id/edit — supervisor scope", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		tx.user.findMany.mockResolvedValue([])
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
			session: {},
		} as any)
	})

	function formRequest(form: FormData) {
		return new Request("http://localhost/docs/doc-1/edit", {
			method: "POST",
			body: form,
		})
	}

	function validForm() {
		const form = new FormData()
		form.set("jobType", "Install")
		form.set("jobAddressEstimated", "123 Main")
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		return form
	}

	it("blocks a Supervisor from editing a doc outside their area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)

		await expect(
			action({
				request: formRequest(validForm()),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.brigade.findUnique).not.toHaveBeenCalled()
	})

	it("allows a Supervisor to edit a doc in their brigade's area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			area: "SUR",
			memberIds: ["crew-1"],
		} as any)

		await expect(
			action({
				request: formRequest(validForm()),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.brigade.findUnique).toHaveBeenCalled()
	})

	it("rejects reassigning to a brigade in a foreign area, even when the doc itself is in scope", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-metro",
			area: "METRO",
			memberIds: ["crew-metro"],
		} as any)

		const form = validForm()
		form.set("brigadeId", "b-metro")

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({ errorKey: "docs_edit.errors.brigade_invalid" })
		expect(db.$transaction).not.toHaveBeenCalled()
	})
})

describe("several brigades on a work order", () => {
	const brigades: Record<string, any> = {
		b1: { id: "b1", area: "SUR", memberIds: ["u1", "u2"] },
		b2: { id: "b2", area: "SUR", memberIds: ["u2", "u3"] },
	}
	const history = [
		{ userIds: ["u1", "u2"], brigadeId: "b1", brigadeIds: ["b1"] },
	]

	beforeEach(() => {
		vi.clearAllMocks()
		tx.user.findMany.mockResolvedValue([])
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockImplementation(
			(async ({ where }: any) => brigades[where.id] ?? null) as any,
		)
	})

	function form(ids: string[]) {
		const f = new FormData()
		f.set("jobType", "Install")
		f.set("jobAddressEstimated", "123 Main")
		f.set("materials", "[]")
		for (const id of ids) f.append("brigadeId", id)
		return f
	}
	const run = (ids: string[]) =>
		action({
			request: new Request("http://localhost/docs/doc-1/edit", {
				method: "POST",
				body: form(ids),
			}),
			params: { id: "doc-1" },
		} as any).catch((r) => r)

	it("the form is pre-selected with every assigned brigade, lead first", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({
				brigadeId: "b2",
				crewAssignmentHistory: [{ brigadeId: "b2", brigadeIds: ["b2", "b1"] }],
			}) as any,
		)
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		const data = await loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)
		expect(data.assignedBrigadeIds).toEqual(["b2", "b1"])
	})

	it("saving two brigades keeps both, with the first as lead and every crew assigned", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ crewAssignmentHistory: history }) as any,
		)
		const res = await run(["b2", "b1"])
		expect(res.status).toBe(302)
		const { data } = tx.jafInvoice.update.mock.calls[0][0]
		expect(data.brigadeId).toBe("b2")
		expect(data.assignedCrewIds).toEqual(["u2", "u3", "u1"])
		expect(data.crewAssignmentHistory).toEqual([
			...history,
			expect.objectContaining({
				brigadeId: "b2",
				brigadeIds: ["b2", "b1"],
				assignedById: "user-1",
			}),
		])
		expect(tx.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				diffJson: expect.objectContaining({ brigadeIds: ["b2", "b1"] }),
			}),
		})
	})

	it("re-saving an unchanged multi-brigade job keeps the crews and adds no history entry", async () => {
		const multi = [{ brigadeId: "b1", brigadeIds: ["b1", "b2"] }]
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ crewAssignmentHistory: multi }) as any,
		)
		const res = await run(["b1", "b2"])
		expect(res.status).toBe(302)
		const { data } = tx.jafInvoice.update.mock.calls[0][0]
		expect(data.assignedCrewIds).toEqual(["u1", "u2", "u3"])
		expect(data.brigadeId).toBe("b1")
		expect(data).not.toHaveProperty("crewAssignmentHistory")
	})

	it("rejects the edit if any selected brigade is outside the supervisor's areas", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		brigades.bx = { id: "bx", area: "METRO", memberIds: ["u9"] }
		const res = await run(["b1", "bx"])
		expect(res).toEqual({ errorKey: "docs_edit.errors.brigade_invalid" })
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("edit form data", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN" },
			session: {},
		} as any)
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
	})

	it("returns catalog unit and price for the saved service lines so the table can show them", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({
				serviceLines: [
					{
						serviceCodeId: "sc1",
						claroCode: "34005445",
						qty: 2,
						name: "X",
						accountCode: "635",
					},
				],
			}) as any,
		)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc1", unit: "FT", unitPrice: "5.0600" },
		] as any)
		const data = await loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)
		expect(db.serviceCode.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: ["sc1"] } } }),
		)
		expect(data.serviceLineMeta).toEqual({
			sc1: { unit: "FT", unitPrice: 5.06 },
		})
	})
})

describe("edit never touches the Aviso number", () => {
	const brigade = { id: "b1", area: "SUR", memberIds: ["u1"] }
	beforeEach(() => {
		vi.clearAllMocks()
		tx.user.findMany.mockResolvedValue([])
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN" },
			session: {},
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(brigade as any)
	})
	const run = (aviso: string) => {
		const f = new FormData()
		f.set("jobType", "Install")
		f.set("jobAddressEstimated", "123 Main")
		f.set("materials", "[]")
		f.set("brigadeId", "b1")
		f.set("avisoNumber", aviso)
		return action({
			request: new Request("http://localhost/docs/doc-1/edit", {
				method: "POST",
				body: f,
			}),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
	}

	it("leaves the stored Aviso untouched, even if one is posted", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ avisoNumber: null }) as any,
		)
		const res = await run("10353961")
		expect(res.status).toBe(302)
		const { data } = tx.jafInvoice.update.mock.calls[0][0]
		expect(data).not.toHaveProperty("avisoNumber")
	})
})

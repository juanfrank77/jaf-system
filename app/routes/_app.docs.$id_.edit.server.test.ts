import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
	jafInvoice: { update: vi.fn() },
	auditTrail: { create: vi.fn() },
	user: { findMany: vi.fn() },
	notification: { create: vi.fn() },
}))
vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			groupBy: vi.fn(() => Promise.resolve([])),
		},
		auditTrail: { create: vi.fn(), count: vi.fn(() => Promise.resolve(0)) },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		brigade: { findMany: vi.fn(), findUnique: vi.fn() },
		serviceCode: { findMany: vi.fn(() => Promise.resolve([])) },
		$transaction: vi.fn(async (fn: any) => fn(tx)),
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
// The guard's database half is covered against a real DB in
// brigade-picker.server.test.ts.
vi.mock("~/lib/brigade-picker.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/brigade-picker.server")>()),
	assignBrigadesOrThrow: vi.fn(),
}))
vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	getActiveMaterialCodes: vi.fn(() => Promise.resolve([])),
}))

import {
	assignBrigadesOrThrow,
	BRIGADE_INVALID,
	BrigadeAssignError,
} from "~/lib/brigade-picker.server"
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
		materialsFromWarehouse: true,
		materialsReason: null,
		prefieldNeeded: false,
		fieldStartedAt: null,
		jafInvoicePdfPath: null,
		jafInvoiceGeneratedAt: null,
		...overrides,
	}
}

/** The edit form always posts both intake answers (pre-filled from the doc). */
function answers(
	f: FormData,
	materials = "yes",
	prefield = "not_needed",
	reason?: string,
) {
	f.set("materialsFromWarehouse", materials)
	f.set("prefieldNeeded", prefield)
	if (reason !== undefined) f.set("materialsReason", reason)
	return f
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
		vi.mocked(db.brigade.findMany).mockResolvedValue([])

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
		return answers(form)
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
			active: true,
			memberIds: ["crew-1"],
		} as any)

		await expect(
			action({
				request: formRequest(validForm()),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.brigade.findUnique).toHaveBeenCalled()
		// b1 is already on the job: it passes through, no guard, no activation.
		expect(assignBrigadesOrThrow).not.toHaveBeenCalled()
	})

	it("refuses an equipment (D) account posted by hand and saves nothing", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-d",
			area: "SUR",
			active: true,
			isEquipmentAccount: true,
			memberIds: [],
		} as any)
		const form = validForm()
		form.set("brigadeId", "b-d")
		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_edit.errors.brigade_invalid" })
		expect(db.$transaction).not.toHaveBeenCalled()
	})

	it("reports a brigade that became unavailable mid-save", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-idle",
			area: null,
			active: false,
			memberIds: [],
		} as any)
		vi.mocked(assignBrigadesOrThrow).mockRejectedValueOnce(
			new BrigadeAssignError(BRIGADE_INVALID),
		)
		const form = validForm()
		form.set("brigadeId", "b-idle")
		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_edit.errors.brigade_invalid" })
	})
})

describe("several brigades on a work order", () => {
	const brigades: Record<string, any> = {
		b1: { id: "b1", area: "SUR", active: true, memberIds: ["u1", "u2"] },
		b2: { id: "b2", area: "SUR", active: true, memberIds: ["u2", "u3"] },
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
		return answers(f)
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
		// Only the newly added brigade goes through the guard, with the save.
		expect(assignBrigadesOrThrow).toHaveBeenCalledWith(tx, {
			docId: "doc-1",
			viewer: { id: "user-1", role: "SUPERVISOR", areas: ["SUR"] },
			brigadeIds: ["b2"],
		})
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

	it.each([
		[
			"terminated",
			{ active: true, terminatedAt: new Date() },
			"docs_edit.errors.brigade_invalid",
		],
	])(
		"refuses making a kept brigade %s the lead (payee), as change_lead does",
		async (_label, extra, errorKey) => {
			brigades.bk = { id: "bk", area: "SUR", memberIds: ["u7"], ...extra }
			try {
				vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
					baseDoc({
						crewAssignmentHistory: [
							{ brigadeId: "b1", brigadeIds: ["b1", "bk"] },
						],
					}) as any,
				)
				// Kept as a second crew: passes through unchanged.
				expect((await run(["b1", "bk"])).status).toBe(302)
				vi.clearAllMocks()
				// Promoted to lead: the payee check applies.
				expect(await run(["bk", "b1"])).toEqual({ errorKey })
				expect(tx.jafInvoice.update).not.toHaveBeenCalled()
			} finally {
				delete brigades.bk
			}
		},
	)
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
	const brigade = { id: "b1", area: "SUR", active: true, memberIds: ["u1"] }
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
		answers(f)
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

describe("three-edit limit for supervisors", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		tx.user.findMany.mockResolvedValue([])
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
	})

	function as(role: "SUPERVISOR" | "ADMIN") {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role },
			session: {},
		} as any)
	}

	function post() {
		const form = new FormData()
		form.set("jobType", "Install")
		form.set("jobAddressEstimated", "123 Main")
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		answers(form)
		return action({
			request: new Request("http://localhost/docs/doc-1/edit", {
				method: "POST",
				body: form,
			}),
			params: { id: "doc-1" },
		} as any)
	}

	function load() {
		return loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)
	}

	it("counts the work order's edit audit rows", async () => {
		as("SUPERVISOR")
		vi.mocked(db.auditTrail.count).mockResolvedValue(2)
		const result = await load()
		expect(result.editsUsed).toBe(2)
		expect(db.auditTrail.count).toHaveBeenCalledWith({
			where: { docId: "doc-1", action: "WORK_ORDER_EDITED" },
		})
	})

	it("lets a supervisor make the third edit", async () => {
		as("SUPERVISOR")
		vi.mocked(db.auditTrail.count).mockResolvedValue(2)
		await expect(post()).rejects.toMatchObject({ status: 302 })
		expect(tx.jafInvoice.update).toHaveBeenCalled()
	})

	it("refuses a fourth edit and saves nothing", async () => {
		as("SUPERVISOR")
		vi.mocked(db.auditTrail.count).mockResolvedValue(3)
		await expect(post()).resolves.toEqual({
			errorKey: "docs_edit.errors.limit_reached",
		})
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("does not limit an admin", async () => {
		as("ADMIN")
		vi.mocked(db.auditTrail.count).mockResolvedValue(9)
		expect((await load()).editsUsed).toBeNull()
		await expect(post()).rejects.toMatchObject({ status: 302 })
		expect(db.auditTrail.count).not.toHaveBeenCalled()
		expect(tx.jafInvoice.update).toHaveBeenCalled()
	})
})

describe("intake answers on the edit page", () => {
	const brigade = { id: "b1", area: "SUR", active: true, memberIds: ["u1"] }
	beforeEach(() => {
		vi.clearAllMocks()
		tx.user.findMany.mockResolvedValue([{ id: "wh-1" }])
		vi.mocked(db.auditTrail.count).mockResolvedValue(0)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(brigade as any)
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
			session: {},
		} as any)
	})
	function doc(overrides: Record<string, unknown> = {}) {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc(overrides) as any,
		)
	}
	function edit(
		materials: string,
		prefield: string,
		reason?: string,
		items = "[]",
	) {
		const f = new FormData()
		f.set("jobType", "Install")
		f.set("jobAddressEstimated", "123 Main")
		f.set("brigadeId", "b1")
		f.set("materials", items)
		answers(f, materials, prefield, reason)
		return action({
			request: new Request("http://localhost/docs/doc-1/edit", {
				method: "POST",
				body: f,
			}),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
	}
	const updated = () => tx.jafInvoice.update.mock.calls[0][0].data

	it("the loader exposes both stored answers", async () => {
		doc({
			materialsFromWarehouse: false,
			materialsReason: "own truck",
			prefieldNeeded: true,
			status: "SIGNED",
		})
		const data = await loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)
		expect(data.intakeAnswers).toEqual({
			materials: "no",
			materialsReason: "own truck",
			prefield: "needed",
		})
	})

	it("changing an answer is one edit: one WORK_ORDER_EDITED row naming it", async () => {
		doc()
		const res = await edit("yes", "needed")
		expect(res.status).toBe(302)
		expect(updated().prefieldNeeded).toBe(true)
		expect(tx.auditTrail.create).toHaveBeenCalledTimes(1)
		expect(tx.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: "WORK_ORDER_EDITED",
				diffJson: expect.objectContaining({
					answersChanged: true,
					prefieldNeeded: { before: false, after: true },
				}),
			}),
		})
	})

	it("an answer change still counts against the three-edit limit", async () => {
		doc()
		vi.mocked(db.auditTrail.count).mockResolvedValue(3)
		expect(await edit("yes", "needed")).toEqual({
			errorKey: "docs_edit.errors.limit_reached",
		})
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("rejects a missing answer", async () => {
		doc()
		expect(await edit("no", "needed", "  ")).toEqual({
			errorKey: "docs_new.errors.materials_reason_required",
		})
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("Yes→No before prep skips the warehouse: SIGNED, materials cleared", async () => {
		doc({ estimatedMaterials: [{ serviceCodeId: "m1", qty: 2 }] })
		const res = await edit(
			"no",
			"not_needed",
			" Claro drop-off ",
			JSON.stringify([{ serviceCodeId: "m1", qty: 2 }]),
		)
		expect(res.status).toBe(302)
		expect(updated()).toEqual(
			expect.objectContaining({
				status: "SIGNED",
				materialsFromWarehouse: false,
				materialsReason: "Claro drop-off",
				estimatedMaterials: [],
			}),
		)
		expect(tx.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				diffJson: expect.objectContaining({
					status: { before: "CREATED", after: "SIGNED" },
				}),
			}),
		})
	})

	it("Yes→No after prep is refused and saves nothing", async () => {
		doc({ status: "PREPPED" })
		expect(await edit("no", "not_needed", "own truck")).toEqual({
			errorKey: "docs_edit.errors.warehouse_started",
		})
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("No→Yes before Field sends the job to the warehouse", async () => {
		doc({
			status: "SIGNED",
			materialsFromWarehouse: false,
			materialsReason: "own truck",
		})
		const res = await edit(
			"yes",
			"not_needed",
			"own truck",
			JSON.stringify([{ serviceCodeId: "m1", qty: 4 }]),
		)
		expect(res.status).toBe(302)
		expect(updated()).toEqual(
			expect.objectContaining({
				status: "CREATED",
				materialsFromWarehouse: true,
				materialsReason: null,
				estimatedMaterials: [{ serviceCodeId: "m1", qty: 4 }],
			}),
		)
		expect(tx.user.findMany).toHaveBeenCalledWith({
			where: { role: "WAREHOUSE", active: true },
		})
		expect(tx.notification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ userId: "wh-1", docId: "doc-1" }),
		})
	})

	it("No→Yes after Field started is refused", async () => {
		doc({
			status: "SIGNED",
			materialsFromWarehouse: false,
			materialsReason: "own truck",
			fieldStartedAt: new Date(),
		})
		expect(await edit("yes", "not_needed")).toEqual({
			errorKey: "docs_edit.errors.field_started",
		})
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("a no-warehouse job before Field is editable; a warehouse job at SIGNED is not", async () => {
		doc({
			status: "SIGNED",
			materialsFromWarehouse: false,
			materialsReason: "x",
		})
		const ok = await loader({
			request: new Request("http://localhost/docs/doc-1/edit"),
			params: { id: "doc-1" },
		} as any)
		expect(ok.doc.id).toBe("doc-1")
		doc({ status: "SIGNED" })
		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1/edit"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	describe("generated package", () => {
		const generated = { jafInvoicePdfPath: "/uploads/packets/doc-1.pdf" }

		it.each([
			["prefield", () => edit("yes", "needed")],
			["materials answer", () => edit("no", "not_needed", "own truck")],
		])("changing the %s marks an unsent package stale", async (_, run) => {
			doc(generated)
			await run()
			expect(updated().packetStale).toBe(true)
		})

		it("changing the reason marks it stale", async () => {
			doc({
				...generated,
				status: "SIGNED",
				materialsFromWarehouse: false,
				materialsReason: "own truck",
			})
			await edit("no", "not_needed", "Claro drop-off")
			expect(updated().packetStale).toBe(true)
		})

		it("an edit that leaves the answers alone does not", async () => {
			doc(generated)
			await edit("yes", "not_needed")
			expect(updated()).not.toHaveProperty("packetStale")
		})

		it("after the first send the package is left as sent", async () => {
			doc({ ...generated, jafInvoiceGeneratedAt: new Date() })
			await edit("yes", "needed")
			expect(updated()).not.toHaveProperty("packetStale")
		})
	})
})

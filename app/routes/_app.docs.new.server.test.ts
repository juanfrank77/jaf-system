import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = {
	jafInvoice: { create: vi.fn(), update: vi.fn() },
	auditTrail: { create: vi.fn() },
	notification: { createMany: vi.fn() },
}
vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findUnique: vi.fn(), findMany: vi.fn() },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		claroSupervisor: { findUnique: vi.fn(), findMany: vi.fn() },
		$transaction: vi.fn(async (fn: any) => fn(tx)),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/control-number.server", () => ({
	generateControlNumber: vi.fn(),
}))
vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	getActiveMaterialCodes: vi.fn(),
}))

vi.mock("~/lib/address-suggestions.server", () => ({
	canonicalizeAddress: vi.fn(async (a: any) => ({
		...a,
		tipo: a.tipo === "calle" ? "CALLE" : a.tipo,
	})),
	loadAddressSuggestions: vi.fn(async () => ({
		tipo: [],
		tipoPlanta: [],
		grupoPlan: [],
	})),
}))
vi.mock("~/lib/uploads.server", () => ({ saveUpload: vi.fn() }))

import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { saveUpload } from "~/lib/uploads.server"
import { action, loader } from "./_app.docs.new"

function post(form: FormData) {
	return new Request("http://localhost/docs/new", {
		method: "POST",
		body: form,
	})
}

describe("POST /docs/new", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(generateControlNumber).mockResolvedValue("MAINT-260903-001")
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "wh-1" }] as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["CENTRAL"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			area: "CENTRAL",
			memberIds: ["crew-1", "crew-2"],
		} as any)
		tx.jafInvoice.create.mockResolvedValue({ id: "doc-1" })
		vi.mocked(db.claroSupervisor.findUnique).mockResolvedValue({
			id: "cs-1",
			active: true,
			requiresPrefield: false,
			requiresBlueprint: false,
		} as any)
		vi.mocked(saveUpload).mockResolvedValue("/uploads/blueprints/doc-1/bp.pdf")
	})

	function addr(form: FormData) {
		form.set("claroSupervisorId", "cs-1")
		form.set("direccion1", "119")
		form.set("sector", "Sector Palomar")
		form.set("tipo", "calle")
		form.set("tipoPlanta", "Aerea")
		form.set("grupoPlan", "G1")
		return form
	}

	it("stores description, service lines and the brigade, and fills assignedCrewIds from the brigade", async () => {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("jobDescription", "Transferencia de attachments")
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		form.set(
			"serviceLines",
			JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					accountCode: "610",
					name: "TRANSFER ATTCH DE POSTESMC",
					qty: 5,
				},
			]),
		)
		const res = await action({ request: post(form), params: {} } as any).catch(
			(r) => r,
		)
		expect(res.status).toBe(302)
		expect(tx.jafInvoice.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				jobDescription: "Transferencia de attachments",
				brigadeId: "b1",
				assignedCrewIds: ["crew-1", "crew-2"],
				serviceLines: [
					{
						serviceCodeId: "c1",
						claroCode: "34006301",
						accountCode: "610",
						name: "TRANSFER ATTCH DE POSTESMC",
						qty: 5,
					},
				],
			}),
		})
	})

	function validForm(aviso?: string) {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		if (aviso !== undefined) form.set("avisoNumber", aviso)
		return form
	}

	it("never stores an Aviso number at intake, even if one is posted", async () => {
		const res = await action({
			request: post(validForm("10353961")),
			params: {},
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
		const { data } = tx.jafInvoice.create.mock.calls[0][0]
		expect(data).not.toHaveProperty("avisoNumber")
	})

	it("stores the canonicalised address, Prefield, supervisor and composed jobAddressEstimated", async () => {
		const form = addr(validForm())
		form.set("ordenNumber", "O-1")
		form.set("pedido", "P-1")
		const res = await action({ request: post(form), params: {} } as any).catch(
			(r) => r,
		)
		expect(res.status).toBe(302)
		const { data } = tx.jafInvoice.create.mock.calls[0][0]
		expect(data).toEqual(
			expect.objectContaining({
				claroSupervisorId: "cs-1",
				direccion1: "119",
				sector: "Sector Palomar",
				tipo: "CALLE",
				tipoPlanta: "Aerea",
				grupoPlan: "G1",
				jobAddressEstimated: "119, Sector Palomar",
				ordenNumber: "O-1",
				pedido: "P-1",
				smr: null,
				titulo: null,
			}),
		)
	})

	it("requires an active Claro supervisor", async () => {
		const noSup = addr(validForm())
		noSup.delete("claroSupervisorId")
		expect(await action({ request: post(noSup), params: {} } as any)).toEqual({
			errorKey: "docs_new.errors.claro_supervisor_required",
		})
		vi.mocked(db.claroSupervisor.findUnique).mockResolvedValue({
			id: "cs-1",
			active: false,
		} as any)
		expect(
			await action({ request: post(addr(validForm())), params: {} } as any),
		).toEqual({ errorKey: "docs_new.errors.claro_supervisor_required" })
		expect(tx.jafInvoice.create).not.toHaveBeenCalled()
	})

	it("rejects a missing Dirección 1", async () => {
		const form = addr(validForm())
		form.delete("direccion1")
		expect(await action({ request: post(form), params: {} } as any)).toEqual({
			errorKey: "docs_new.errors.address_required",
		})
	})

	it("notifies warehouse users only", async () => {
		await action({ request: post(addr(validForm())), params: {} } as any).catch(
			(r) => r,
		)
		expect(db.user.findMany).toHaveBeenCalledWith({
			where: { role: "WAREHOUSE", active: true },
		})
		const { data } = tx.notification.createMany.mock.calls[0][0]
		expect(data.map((n: any) => n.userId)).toEqual(["wh-1"])
	})

	it("saves an optional blueprint into blueprintPaths", async () => {
		const form = addr(validForm())
		form.append(
			"blueprint",
			new File(["x"], "plan.pdf", { type: "application/pdf" }),
		)
		await action({ request: post(form), params: {} } as any).catch((r) => r)
		expect(saveUpload).toHaveBeenCalledWith(
			"blueprints/doc-1",
			expect.stringMatching(/plan\.pdf$/),
			expect.any(File),
		)
		expect(tx.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { blueprintPaths: ["/uploads/blueprints/doc-1/bp.pdf"] },
		})
	})

	it("creates fine with no blueprint and no Prefield", async () => {
		await action({ request: post(addr(validForm())), params: {} } as any).catch(
			(r) => r,
		)
		expect(saveUpload).not.toHaveBeenCalled()
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
		const { data } = tx.jafInvoice.create.mock.calls[0][0]
		expect(data.ordenNumber).toBeNull()
	})

	describe("several brigades", () => {
		const brigades: Record<string, any> = {
			b1: { id: "b1", name: "A", area: "CENTRAL", memberIds: ["u1", "u2"] },
			b2: { id: "b2", name: "B", area: "CENTRAL", memberIds: ["u2", "u3"] },
			bx: { id: "bx", name: "X", area: "METRO", memberIds: ["u9"] },
		}
		function multiForm(ids: string[]) {
			const form = validForm()
			form.delete("brigadeId")
			for (const id of ids) form.append("brigadeId", id)
			return form
		}
		beforeEach(() => {
			vi.mocked(db.brigade.findUnique).mockImplementation(
				(async ({ where }: any) => brigades[where.id] ?? null) as any,
			)
		})

		it("makes the first the lead, unions the crews, and records every brigade", async () => {
			const res = await action({
				request: post(multiForm(["b2", "b1"])),
				params: {},
			} as any).catch((r) => r)
			expect(res.status).toBe(302)
			const { data } = tx.jafInvoice.create.mock.calls[0][0]
			expect(data.brigadeId).toBe("b2")
			expect(data.assignedCrewIds).toEqual(["u2", "u3", "u1"])
			expect(data.crewAssignmentHistory).toEqual([
				expect.objectContaining({
					brigadeId: "b2",
					brigadeIds: ["b2", "b1"],
					userIds: ["u2", "u3", "u1"],
					assignedById: "sup-1",
				}),
			])
			expect(tx.auditTrail.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({ brigadeIds: ["b2", "b1"] }),
				}),
			})
		})

		it("rejects the whole assignment if any brigade is outside the supervisor's areas", async () => {
			const res = await action({
				request: post(multiForm(["b1", "bx"])),
				params: {},
			} as any)
			expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
			expect(tx.jafInvoice.create).not.toHaveBeenCalled()
		})

		it("rejects an unknown brigade id", async () => {
			const res = await action({
				request: post(multiForm(["b1", "nope"])),
				params: {},
			} as any)
			expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
		})
	})

	it("rejects a missing brigade", async () => {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		const res = await action({ request: post(form), params: {} } as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.missing_fields" })
	})

	it("rejects assigning a brigade outside the supervisor's admin-assigned areas", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-metro",
			name: "OTHER CREW",
			area: "METRO",
			memberIds: ["crew-metro"],
		} as any)

		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("brigadeId", "b-metro")
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		const res = await action({ request: post(form), params: {} } as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
		expect(tx.jafInvoice.create).not.toHaveBeenCalled()
	})

	it("rejects malformed service lines", async () => {
		const form = new FormData()
		form.set("jobType", "M")
		addr(form)
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		form.set("serviceLines", "{nope")
		const res = await action({ request: post(form), params: {} } as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.invalid_service_lines" })
	})
})

describe("GET /docs/new", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getActiveMaterialCodes).mockResolvedValue([])
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		vi.mocked(db.claroSupervisor.findMany).mockResolvedValue([])
	})

	it("bounds the SUPERVISOR brigade picker to take: 100", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["CENTRAL"],
		} as any)

		await loader({
			request: new Request("http://localhost/docs/new"),
			params: {},
		} as any)

		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 100 }),
		)
	})

	it("sends a supervisor the material catalog without any price, and Admin with it", async () => {
		const material = {
			id: "m1",
			claroCode: "1020002",
			name: "WRAP",
			unitPrice: "5.0600",
		}
		vi.mocked(getActiveMaterialCodes).mockResolvedValue([material] as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["CENTRAL"],
		} as any)
		const load = async (role: string) => {
			vi.mocked(requireRole).mockResolvedValue({
				user: { id: "u1", role },
				session: {},
			} as any)
			return loader({
				request: new Request("http://localhost/docs/new"),
				params: {},
			} as any)
		}
		const sup = await load("SUPERVISOR")
		expect(sup.showPrices).toBe(false)
		expect("unitPrice" in sup.serviceCodes[0]).toBe(false)
		const admin = await load("ADMIN")
		expect(admin.showPrices).toBe(true)
		expect(admin.serviceCodes[0].unitPrice).toBe(5.06)
	})

	it("does not bound the ADMIN brigade picker", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN" },
			session: {},
		} as any)

		await loader({
			request: new Request("http://localhost/docs/new"),
			params: {},
		} as any)

		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: undefined }),
		)
	})
})

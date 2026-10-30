import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = {
	jafInvoice: { create: vi.fn(), update: vi.fn() },
	auditTrail: { create: vi.fn() },
	notification: { createMany: vi.fn() },
}
vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findUnique: vi.fn(), findMany: vi.fn() },
		jafInvoice: { groupBy: vi.fn(() => Promise.resolve([])) },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		claroSupervisor: { findFirst: vi.fn(), findMany: vi.fn() },
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
// The guard's database half is covered against a real DB in
// brigade-picker.server.test.ts and _app.docs.new.brigade-guard.server.test.ts.
vi.mock("~/lib/brigade-picker.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/brigade-picker.server")>()),
	assignBrigadesOrThrow: vi.fn(),
}))

import {
	assignBrigadesOrThrow,
	BRIGADE_INVALID,
	BrigadeAssignError,
} from "~/lib/brigade-picker.server"
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
			active: true,
			supervisorId: null,
			memberIds: ["crew-1", "crew-2"],
		} as any)
		tx.jafInvoice.create.mockResolvedValue({ id: "doc-1" })
		vi.mocked(db.claroSupervisor.findFirst).mockResolvedValue({
			id: "cs-1",
			active: true,
			requiresPrefield: false,
			requiresBlueprint: false,
		} as any)
	})

	function addr(form: FormData) {
		form.set("claroSupervisorId", "cs-1")
		form.set("direccion1", "119")
		form.set("sector", "Sector Palomar")
		form.set("tipo", "calle")
		form.set("tipoPlanta", "Aerea")
		form.set("grupoPlan", "G1")
		if (!form.has("materialsFromWarehouse"))
			form.set("materialsFromWarehouse", "yes")
		if (!form.has("prefieldNeeded")) form.set("prefieldNeeded", "not_needed")
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

	function validForm() {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		return form
	}

	it("no longer stores Aviso # or the Prefield fields from the form", async () => {
		const form = validForm()
		form.set("avisoNumber", "10353961")
		for (const k of ["ordenNumber", "pedido", "smr", "titulo"]) form.set(k, "X")
		await action({ request: post(form), params: {} } as any).catch((r) => r)
		const { data } = tx.jafInvoice.create.mock.calls[0][0]
		for (const k of ["avisoNumber", "ordenNumber", "pedido", "smr", "titulo"])
			expect(data).not.toHaveProperty(k)
	})

	describe("intake answers", () => {
		it.each([
			["materialsFromWarehouse", "docs_new.errors.materials_choice_required"],
			["prefieldNeeded", "docs_new.errors.prefield_choice_required"],
		])("blocks Create without %s", async (field, errorKey) => {
			const form = validForm()
			form.delete(field)
			expect(await action({ request: post(form), params: {} } as any)).toEqual({
				errorKey,
			})
			expect(tx.jafInvoice.create).not.toHaveBeenCalled()
			expect(tx.notification.createMany).not.toHaveBeenCalled()
		})

		it("blocks Create on No without a reason", async () => {
			const form = validForm()
			form.set("materialsFromWarehouse", "no")
			form.set("materialsReason", "  ")
			expect(await action({ request: post(form), params: {} } as any)).toEqual({
				errorKey: "docs_new.errors.materials_reason_required",
			})
			expect(tx.jafInvoice.create).not.toHaveBeenCalled()
		})

		it("No skips the warehouse: SIGNED, reason stored, no materials, no warehouse notice", async () => {
			const form = validForm()
			form.set("materialsFromWarehouse", "no")
			form.set("materialsReason", " own truck ")
			form.set("materials", JSON.stringify([{ serviceCodeId: "m1", qty: 3 }]))
			const res = await action({
				request: post(form),
				params: {},
			} as any).catch((r) => r)
			expect(res.status).toBe(302)
			const { data } = tx.jafInvoice.create.mock.calls[0][0]
			expect(data).toEqual(
				expect.objectContaining({
					status: "SIGNED",
					materialsFromWarehouse: false,
					materialsReason: "own truck",
					estimatedMaterials: [],
				}),
			)
			expect(tx.notification.createMany).not.toHaveBeenCalled()
			expect(tx.auditTrail.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						status: { before: null, after: "SIGNED" },
						materialsFromWarehouse: false,
						materialsReason: "own truck",
						prefieldNeeded: false,
					}),
				}),
			})
		})

		it("Yes keeps the warehouse path: CREATED, materials kept, warehouse notified", async () => {
			const form = validForm()
			form.set("materials", JSON.stringify([{ serviceCodeId: "m1", qty: 3 }]))
			await action({ request: post(form), params: {} } as any).catch((r) => r)
			const { data } = tx.jafInvoice.create.mock.calls[0][0]
			expect(data).toEqual(
				expect.objectContaining({
					status: "CREATED",
					materialsFromWarehouse: true,
					materialsReason: null,
					estimatedMaterials: [{ serviceCodeId: "m1", qty: 3 }],
				}),
			)
			expect(tx.notification.createMany).toHaveBeenCalledTimes(1)
		})

		it("stores the posted Prefield answer, not the Claro supervisor's tag", async () => {
			vi.mocked(db.claroSupervisor.findFirst).mockResolvedValue({
				id: "cs-1",
				active: true,
				requiresPrefield: true,
				requiresBlueprint: false,
			} as any)
			const form = validForm()
			form.set("prefieldNeeded", "not_needed")
			await action({ request: post(form), params: {} } as any).catch((r) => r)
			expect(tx.jafInvoice.create.mock.calls[0][0].data.prefieldNeeded).toBe(
				false,
			)
			tx.jafInvoice.create.mockClear()
			vi.mocked(db.claroSupervisor.findFirst).mockResolvedValue({
				id: "cs-1",
				active: true,
				requiresPrefield: false,
				requiresBlueprint: false,
			} as any)
			const needed = validForm()
			needed.set("prefieldNeeded", "needed")
			await action({ request: post(needed), params: {} } as any).catch((r) => r)
			expect(tx.jafInvoice.create.mock.calls[0][0].data.prefieldNeeded).toBe(
				true,
			)
		})
	})

	it("requires a job type", async () => {
		const form = validForm()
		form.delete("jobType")
		expect(await action({ request: post(form), params: {} } as any)).toEqual({
			errorKey: "docs_new.errors.missing_fields",
		})
	})

	it("stores the canonicalised address, supervisor and composed jobAddressEstimated", async () => {
		const form = addr(validForm())
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
			}),
		)
	})

	it("requires an active Claro supervisor", async () => {
		const noSup = addr(validForm())
		noSup.delete("claroSupervisorId")
		expect(await action({ request: post(noSup), params: {} } as any)).toEqual({
			errorKey: "docs_new.errors.claro_supervisor_required",
		})
		vi.mocked(db.claroSupervisor.findFirst).mockResolvedValue({
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

	it("takes no blueprint on this screen: it is uploaded on the field update", async () => {
		const form = addr(validForm())
		form.append(
			"blueprint",
			new File(["x"], "plan.pdf", { type: "application/pdf" }),
		)
		await action({ request: post(form), params: {} } as any).catch((r) => r)
		expect(saveUpload).not.toHaveBeenCalled()
		expect(tx.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("only accepts a Claro supervisor linked to the supervisor, any for Admin", async () => {
		await action({ request: post(addr(validForm())), params: {} } as any).catch(
			(r) => r,
		)
		expect(db.claroSupervisor.findFirst).toHaveBeenLastCalledWith({
			where: { id: "cs-1", jafSupervisors: { some: { id: "sup-1" } } },
		})
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "adm-1", role: "ADMIN" },
			session: {},
		} as any)
		await action({ request: post(addr(validForm())), params: {} } as any).catch(
			(r) => r,
		)
		expect(db.claroSupervisor.findFirst).toHaveBeenLastCalledWith({
			where: { id: "cs-1" },
		})
	})

	describe("several brigades", () => {
		const brigades: Record<string, any> = {
			b1: {
				id: "b1",
				name: "A",
				area: "CENTRAL",
				active: true,
				memberIds: ["u1", "u2"],
			},
			b2: {
				id: "b2",
				name: "B",
				area: "CENTRAL",
				active: true,
				memberIds: ["u2", "u3"],
			},
			bx: {
				id: "bx",
				name: "X",
				area: "METRO",
				active: true,
				supervisorId: "sup-9",
				memberIds: ["u9"],
			},
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

	it("lets a supervisor add another supervisor's active brigade outside the supervisor's areas", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-metro",
			name: "OTHER CREW",
			area: "METRO",
			active: true,
			supervisorId: "sup-9",
			memberIds: ["crew-metro"],
		} as any)

		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		addr(form)
		form.set("brigadeId", "b-metro")
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		const res = await action({ request: post(form), params: {} } as any).catch(
			(r) => r,
		)
		expect(res.status).toBe(302)
		expect(tx.jafInvoice.create).toHaveBeenCalled()
	})

	it.each([
		["an equipment (D) account", { isEquipmentAccount: true }],
		["a terminated brigade", { terminatedAt: new Date() }],
	])(
		"refuses %s posted by hand, for Admin too, before creating anything",
		async (_label, hidden) => {
			vi.mocked(db.brigade.findUnique).mockResolvedValue({
				id: "b-d",
				name: "D ACCOUNT",
				area: "CENTRAL",
				active: true,
				supervisorId: "sup-1",
				memberIds: [],
				...hidden,
			} as any)
			for (const role of ["SUPERVISOR", "ADMIN"]) {
				vi.mocked(requireRole).mockResolvedValue({
					user: { id: "sup-1", role },
					session: {},
				} as any)
				const res = await action({
					request: post(addr(validForm())),
					params: {},
				} as any)
				expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
			}
			expect(db.$transaction).not.toHaveBeenCalled()
		},
	)

	it("an inactive brigade passes the check: it is activated inside the job transaction", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b-idle",
			name: "IDLE",
			area: null,
			active: false,
			supervisorId: null,
			memberIds: ["crew-9"],
		} as any)
		const form = addr(validForm())
		form.set("brigadeId", "b-idle")
		const res = await action({ request: post(form), params: {} } as any).catch(
			(r) => r,
		)
		expect(res.status).toBe(302)
		expect(assignBrigadesOrThrow).toHaveBeenCalledWith(tx, {
			docId: "doc-1",
			viewer: { id: "sup-1", role: "SUPERVISOR", areas: ["CENTRAL"] },
			brigadeIds: ["b-idle"],
		})
	})

	it("reports a brigade that became unavailable mid-save", async () => {
		vi.mocked(assignBrigadesOrThrow).mockRejectedValueOnce(
			new BrigadeAssignError(BRIGADE_INVALID),
		)
		const res = await action({
			request: post(addr(validForm())),
			params: {},
		} as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
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

	it("gives a SUPERVISOR's picker own, inactive and with-other brigades with their state and supervisor name", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["CENTRAL"],
		} as any)
		const row = (id: string, extra: Record<string, unknown>) => ({
			id,
			name: id,
			area: "METRO",
			code: null,
			leadName: null,
			active: true,
			supervisorId: null,
			isEquipmentAccount: false,
			terminatedAt: null,
			supervisor: null,
			...extra,
		})
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			row("mine", { supervisorId: "sup-1" }),
			row("in-area", { area: "CENTRAL" }),
			row("idle", { active: false }),
			row("other", { supervisorId: "sup-2", supervisor: { name: "Ana" } }),
		] as any)

		const data = await loader({
			request: new Request("http://localhost/docs/new"),
			params: {},
		} as any)

		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { isEquipmentAccount: false, terminatedAt: null },
				take: undefined,
			}),
		)
		const pick = (id: string, state: string, supervisorName: string | null) =>
			expect.objectContaining({ id, state, supervisorName })
		expect(data.brigades).toEqual([
			pick("mine", "own", null),
			pick("in-area", "own", null),
			pick("idle", "inactive", null),
			pick("other", "with_other", "Ana"),
		])
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

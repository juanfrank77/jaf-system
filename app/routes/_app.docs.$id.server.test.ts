import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => {
	const db: any = {
		brigade: {
			findMany: vi.fn(() => Promise.resolve([])),
			findUnique: vi.fn(),
		},
		serviceCode: { findMany: vi.fn(() => Promise.resolve([])) },
		user: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			findMany: vi.fn(),
		},
		auditTrail: { findMany: vi.fn(), create: vi.fn() },
		notification: { createMany: vi.fn(), create: vi.fn() },
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		preCertSheet: { findFirst: vi.fn(() => Promise.resolve(null)) },
	}
	db.$transaction = vi.fn((ops: unknown) =>
		typeof ops === "function"
			? (ops as (tx: unknown) => unknown)(db)
			: Promise.all(ops as Promise<unknown>[]),
	)
	return { db }
})

vi.mock("~/lib/uploads.server", () => ({
	saveUpload: vi.fn(() => Promise.resolve("aviso-docs/doc-1-aviso.pdf")),
}))

vi.mock("~/lib/permissions.server", () => ({
	requireSession: vi.fn(),
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { action, loader, reassignToBrigade } from "./_app.docs.$id"

describe("GET /docs/:id", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
	})

	function baseDoc(
		status = "CREATED",
		overrides: Record<string, unknown> = {},
	) {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status,
			supervisorId: "sup-1",
			assignedCrewIds: [],
			brigade: null,
			...overrides,
		}
	}

	describe("catalog prices in the payload", () => {
		const catalogRow = {
			id: "sc-1",
			claroCode: "34006428",
			name: "TRANSFER STITCH",
			unit: "EA",
			unitPrice: "42.3430",
			contractorPrice: "20.0000",
			claroBasePrice: "30.0000",
		}

		async function loadAs(role: string) {
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "user-1",
				role,
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc("SIGNED", { assignedCrewIds: ["user-1"] }) as any,
			)
			vi.mocked(db.serviceCode.findMany).mockResolvedValue([catalogRow] as any)
			vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
			vi.mocked(db.user.findMany).mockResolvedValue([])
			return loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any)
		}

		it.each(["WAREHOUSE"])("sends %s no price fields", async (role) => {
			const { serviceCodes } = await loadAs(role)
			expect(serviceCodes).toHaveLength(1)
			for (const k of ["unitPrice", "contractorPrice", "claroBasePrice"])
				expect(k in serviceCodes[0]!).toBe(false)
		})

		it("still sends an admin the unit price", async () => {
			const { serviceCodes } = await loadAs("ADMIN")
			expect(serviceCodes[0]?.unitPrice).toBe(42.343)
		})
	})

	it("exposes the names of whoever edited the address", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "ADMIN",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("SIGNED", {
				addressCorrections: [
					{
						original: "a",
						corrected: "b",
						correctedById: "crew-2",
						correctedAt: "2026-10-01T10:00:00.000Z",
					},
				],
			}) as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([
			{ id: "crew-2", name: "Ana Crew" },
		] as any)
		const res = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)
		expect(res.correctorNames).toEqual({ "crew-2": "Ana Crew" })
	})

	describe("billing information by role", () => {
		const billed = {
			avisoNumber: "AV-9",
			claroPdfPath: "/x.pdf",
			avisoLines: [{ unitPrice: 4 }],
			advanceAmount: "100",
			contractorAccountCode: "009",
			jafInvoiceLineTotal: "55",
			retentionAmount: "5",
		}
		async function loadAs(role: string) {
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "user-1",
				role,
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc("SUPERVISOR_APPROVED", {
					assignedCrewIds: ["user-1"],
					...billed,
				}) as any,
			)
			vi.mocked(db.auditTrail.findMany).mockResolvedValue([
				{
					id: "a1",
					action: "AVISO_ENTERED",
					diffJson: { avisoNumber: "AV-9" },
					user: { name: "Sup" },
				},
			] as any)
			vi.mocked(db.user.findMany).mockResolvedValue([])
			return loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any)
		}

		it.each(["INSTALLER"])(
			"does not send %s any billing field or audit payload",
			async (role) => {
				const res = await loadAs(role)
				for (const k of Object.keys(billed))
					expect((res.doc as any)[k]).toBeNull()
				expect(res.auditTrail[0].diffJson).toBeNull()
				expect(JSON.stringify(res)).not.toContain("AV-9")
			},
		)

		it.each(["ADMIN", "FINANCE"])(
			"still sends %s the billing fields",
			async (role) => {
				const res = await loadAs(role)
				expect(res.doc.avisoNumber).toBe("AV-9")
				expect((res.doc as any).advanceAmount).toBe("100")
				expect(res.auditTrail[0].diffJson).toEqual({ avisoNumber: "AV-9" })
			},
		)
	})

	describe("send-back banner data", () => {
		const entry = {
			createdAt: "2026-10-01T10:00:00.000Z",
			byUserId: "sup-1",
			fromStatus: "FIELD_UPDATED",
			toStatus: "SIGNED",
			note: "Photos are blurry",
		}

		async function loadSent(status: string) {
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "user-1",
				role: "ADMIN",
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc(status, {
					assignedCrewIds: ["user-1"],
					sendBackHistory: [entry],
				}) as any,
			)
			vi.mocked(db.user.findUnique).mockResolvedValue({
				id: "sup-1",
				name: "Sam Supervisor",
			} as any)
			vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
			vi.mocked(db.user.findMany).mockResolvedValue([])
			return loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any)
		}

		it("returns the latest send-back and who sent it while the job is back at SIGNED", async () => {
			const res = await loadSent("SIGNED")
			expect(res.latestSendBack?.note).toBe("Photos are blurry")
			expect(res.sentByName).toBe("Sam Supervisor")
		})

		it("returns no send-back once the job was resubmitted", async () => {
			const res = await loadSent("FIELD_UPDATED")
			expect(res.latestSendBack).toBeNull()
			expect(res.sentByName).toBeNull()
		})
	})

	it.each([{ assigned: [] }, { assigned: ["crew-1"] }])(
		"sends a CREW session to the crew notice, assigned or not ($assigned)",
		async ({ assigned }) => {
			vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
				id: "crew-1",
				role: "CREW",
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc("PREPPED", { assignedCrewIds: assigned }) as any,
			)
			const thrown = await loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any).catch((e: unknown) => e)
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).headers.get("Location")).toBe("/crew-notice")
			expect(db.jafInvoice.findUniqueOrThrow).not.toHaveBeenCalled()
		},
	)

	it("allows a Finance user to load an LC_REQUEST_GENERATED doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "FINANCE",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("LC_REQUEST_GENERATED") as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("LC_REQUEST_GENERATED")
	})

	it("allows an Admin user to load an LC_REQUEST_GENERATED doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "ADMIN",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("LC_REQUEST_GENERATED") as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("LC_REQUEST_GENERATED")
	})

	it("blocks a Supervisor from loading an LC_REQUEST_GENERATED doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("LC_REQUEST_GENERATED") as any,
		)

		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 404 })
	})

	it("blocks a Warehouse user from loading an LC_REQUEST_GENERATED doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "WAREHOUSE",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("LC_REQUEST_GENERATED") as any,
		)

		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 404 })
	})

	it("allows a Supervisor to load a normal doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED", { supervisorId: "user-1" }) as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("FIELD_UPDATED")
	})

	it("blocks a Supervisor from loading a doc outside their area", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED", {
				supervisorId: "other-sup",
				brigade: { area: "SUR" },
			}) as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)

		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("allows a Supervisor to load a doc in their brigade's area", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED", {
				supervisorId: "other-sup",
				brigade: { area: "OESTE" },
			}) as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("FIELD_UPDATED")
	})

	it("returns every assigned brigade, lead first, flagging the lead", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "FINANCE",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED", {
				brigadeId: "b2",
				crewAssignmentHistory: [{ brigadeId: "b2", brigadeIds: ["b2", "b1"] }],
			}) as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.brigade.findMany).mockImplementation((async (args: any) =>
			args?.where?.id?.in
				? [
						{ id: "b1", name: "ALEXIS DIAZ", code: "206" },
						{ id: "b2", name: "DINO CASTILLO", code: "209" },
					]
				: []) as any)

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.assignedBrigades).toEqual([
			{ id: "b2", name: "DINO CASTILLO", code: "209", lead: true },
			{ id: "b1", name: "ALEXIS DIAZ", code: "206", lead: false },
		])
	})

	it("allows a Warehouse user to load a normal doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "WAREHOUSE",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("PREPPED") as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("PREPPED")
	})
})

describe("POST /docs/:id (action) — supervisor scope", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	function baseDoc(overrides: Record<string, unknown> = {}) {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "FIELD_UPDATED",
			supervisorId: "other-sup",
			assignedCrewIds: [],
			crewAssignmentHistory: [],
			brigade: { area: "SUR" },
			...overrides,
		}
	}

	it("blocks a Supervisor from cancelling a doc outside their area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)

		const form = new FormData()
		form.set("intent", "cancel")
		form.set("reason", "test")

		await expect(
			action({
				request: new Request("http://localhost/docs/doc-1", {
					method: "POST",
					body: form,
				}),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("allows a Supervisor to cancel a doc in their brigade's area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const form = new FormData()
		form.set("intent", "cancel")
		form.set("reason", "test")

		await expect(
			action({
				request: new Request("http://localhost/docs/doc-1", {
					method: "POST",
					body: form,
				}),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.jafInvoice.update).toHaveBeenCalled()
	})

	it("blocks a Supervisor from reassigning a doc to a brigade in a foreign area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ status: "SIGNED" }) as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-metro",
			area: "METRO",
			memberIds: ["u-metro"],
		} as any)

		const form = new FormData()
		form.set("intent", "reassign")
		form.set("brigadeId", "brigade-metro")

		const result = await action({
			request: new Request("http://localhost/docs/doc-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({ errorKey: "docs_view.errors.reassign_invalid" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("allows a Supervisor to reassign a doc to a brigade in their own area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "user-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ status: "SIGNED" }) as any,
		)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-sur",
			area: "SUR",
			memberIds: ["u-sur"],
		} as any)

		const form = new FormData()
		form.set("intent", "reassign")
		form.set("brigadeId", "brigade-sur")

		await expect(
			action({
				request: new Request("http://localhost/docs/doc-1", {
					method: "POST",
					body: form,
				}),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.jafInvoice.update).toHaveBeenCalled()
		// Crews never log in: nobody on the brigade is notified.
		expect(db.notification.createMany).not.toHaveBeenCalled()
		expect(db.notification.create).not.toHaveBeenCalled()
	})

	it.each(["FIELD_UPDATED", "SUPERVISOR_APPROVED", "CLARO_UPLOADED"])(
		"does not reassign a %s doc: the crew has already reported",
		async (status) => {
			vi.mocked(requireRole).mockResolvedValue({
				user: { id: "user-1", role: "ADMIN" },
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc({ status }) as any,
			)
			vi.mocked(db.jafInvoice.update).mockClear()
			const form = new FormData()
			form.set("intent", "reassign")
			form.set("brigadeId", "brigade-sur")

			await expect(
				action({
					request: new Request("http://localhost/docs/doc-1", {
						method: "POST",
						body: form,
					}),
					params: { id: "doc-1" },
				} as any),
			).rejects.toMatchObject({ status: 302 })

			expect(db.jafInvoice.update).not.toHaveBeenCalled()
		},
	)
})

describe("POST /docs/:id (action) — change lead", () => {
	const members: Record<string, any> = {
		b1: { id: "b1", area: "SUR", memberIds: ["u1", "u2"] },
		b2: { id: "b2", area: "SUR", memberIds: ["u2", "u3"] },
		b3: { id: "b3", area: "SUR", memberIds: ["u4"] },
	}
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		vi.mocked(db.brigade.findUnique).mockImplementation(
			(async ({ where }: any) => members[where.id] ?? null) as any,
		)
		vi.mocked(db.brigade.findMany).mockImplementation((async (args: any) =>
			(args?.where?.id?.in ?? []).map((id: string) => members[id])) as any)
	})

	function shared(overrides: Record<string, unknown> = {}) {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "CREATED",
			supervisorId: "sup-1",
			brigadeId: "b1",
			assignedCrewIds: ["u1", "u2", "u3"],
			crewAssignmentHistory: [{ brigadeId: "b1", brigadeIds: ["b1", "b2"] }],
			contractorAccountCode: null,
			brigade: { area: "SUR" },
			...overrides,
		}
	}
	const run = (intent: string, brigadeId: string) => {
		const form = new FormData()
		form.set("intent", intent)
		form.set("brigadeId", brigadeId)
		return action({
			request: new Request("http://localhost/docs/doc-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
	}

	it("moves the payee to another assigned brigade and keeps every crew", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			shared() as any,
		)
		const res = await run("change_lead", "b2")
		expect(res.status).toBe(302)
		const { data } = vi.mocked(db.jafInvoice.update).mock.calls[0][0] as any
		expect(data.brigadeId).toBe("b2")
		expect(data.assignedCrewIds).toEqual(["u2", "u3", "u1"])
		expect(data.crewAssignmentHistory.at(-1)).toMatchObject({
			brigadeId: "b2",
			brigadeIds: ["b2", "b1"],
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ action: "CREW_LEAD_CHANGED" }),
		})
		expect(db.notification.createMany).not.toHaveBeenCalled()
	})

	it("refuses a brigade that is not already on the job", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			shared() as any,
		)
		const res = await run("change_lead", "b3")
		expect(res).toEqual({ errorKey: "docs_view.errors.reassign_invalid" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("blocks a Supervisor from promoting an on-job brigade outside their areas", async () => {
		const outOfScope = { id: "b4", area: "METRO", memberIds: ["u5"] }
		members.b4 = outOfScope
		try {
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				shared({
					assignedCrewIds: ["u1", "u2", "u5"],
					crewAssignmentHistory: [
						{ brigadeId: "b1", brigadeIds: ["b1", "b4"] },
					],
				}) as any,
			)
			const res = await run("change_lead", "b4")
			expect(res).toEqual({ errorKey: "docs_view.errors.reassign_invalid" })
			expect(db.jafInvoice.update).not.toHaveBeenCalled()
		} finally {
			delete members.b4
		}
	})

	it("lets an Admin promote a brigade in any area", async () => {
		const outOfScope = { id: "b4", area: "METRO", memberIds: ["u5"] }
		members.b4 = outOfScope
		try {
			vi.mocked(requireRole).mockResolvedValue({
				user: { id: "admin-1", role: "ADMIN" },
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				shared({
					assignedCrewIds: ["u1", "u2", "u5"],
					crewAssignmentHistory: [
						{ brigadeId: "b1", brigadeIds: ["b1", "b4"] },
					],
				}) as any,
			)
			const res = await run("change_lead", "b4")
			expect(res.status).toBe(302)
			expect(db.jafInvoice.update).toHaveBeenCalled()
		} finally {
			delete members.b4
		}
	})

	it("refuses once the payee is fixed by the pre-cert signature", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			shared({ contractorAccountCode: "206" }) as any,
		)
		const res = await run("change_lead", "b2")
		expect(res).toEqual({ errorKey: "docs_view.errors.lead_locked" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("reassign keeps earlier history when it was stored in the legacy stringified form", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			shared({ crewAssignmentHistory: '[{"brigadeId":"b1"}]' }) as any,
		)
		await run("reassign", "b3")
		const { data } = vi.mocked(db.jafInvoice.update).mock.calls[0][0] as any
		expect(data.crewAssignmentHistory).toHaveLength(2)
		expect(data.crewAssignmentHistory[0]).toEqual({ brigadeId: "b1" })
		expect(data.crewAssignmentHistory[1]).toMatchObject({
			brigadeId: "b3",
			brigadeIds: ["b3"],
		})
	})
})

describe("POST /docs/:id (action) — Aviso entry", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// The Aviso is captured on the review page (step 7), with its document and
	// line match. A second writer here could set a number the match never saw.
	it("no longer writes an Aviso number from the work-order page", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "SUPERVISOR_APPROVED",
			supervisorId: "sup-1",
			assignedCrewIds: [],
			crewAssignmentHistory: [],
			brigade: null,
		} as any)

		const form = new FormData()
		form.set("intent", "edit_aviso")
		form.set("avisoNumber", "10353961")

		await expect(
			action({
				request: new Request("http://localhost/docs/doc-1", {
					method: "POST",
					body: form,
				}),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})
})

describe("reassignToBrigade", () => {
	it("reassign switches brigadeId AND replaces assignedCrewIds with the new brigade's members", async () => {
		const result = await reassignToBrigade({
			doc: {
				id: "d1",
				brigadeId: "b1",
				assignedCrewIds: ["u-old"],
				crewAssignmentHistory: [],
			},
			newBrigade: { id: "b2", memberIds: ["u-a", "u-b"] },
			byUserId: "sup1",
		})
		expect(result.brigadeId).toBe("b2")
		expect(result.assignedCrewIds).toEqual(["u-a", "u-b"])
		expect(result.crewAssignmentHistory.at(-1)).toMatchObject({
			brigadeId: "b2",
			by: "sup1",
		})
	})

	it("reassign to a brigade with no members clears assignedCrewIds", async () => {
		const result = await reassignToBrigade({
			doc: {
				id: "d1",
				brigadeId: "b1",
				assignedCrewIds: ["u-old"],
				crewAssignmentHistory: [],
			},
			newBrigade: { id: "b3", memberIds: [] },
			byUserId: "sup1",
		})
		expect(result.assignedCrewIds).toEqual([])
	})
})

describe("POST /docs/:id (action) — attach Aviso PDF", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN" },
		} as any)
	})

	const doc = (overrides: Record<string, unknown> = {}) => ({
		id: "doc-1",
		controlNumber: "JAF-1001",
		status: "SUPERVISOR_APPROVED",
		supervisorId: "sup-1",
		assignedCrewIds: [],
		brigade: { area: "SUR" },
		releasedToFinanceAt: new Date("2026-10-14"),
		avisoDocPath: null,
		claroPdfPath: null,
		...overrides,
	})

	function post(file?: File) {
		const form = new FormData()
		form.set("intent", "attach_aviso_pdf")
		if (file) form.set("avisoPdf", file)
		return action({
			request: new Request("http://localhost/docs/doc-1", {
				method: "POST",
				body: form,
			}),
			params: { id: "doc-1" },
		} as any)
	}
	const pdf = () =>
		new File(["%PDF-1.4"], "aviso.pdf", { type: "application/pdf" })

	it("saves the PDF on a released job that has none, and logs it", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc() as any)
		await expect(post(pdf())).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { avisoDocPath: "aviso-docs/doc-1-aviso.pdf" },
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				docId: "doc-1",
				action: "AVISO_PDF_ATTACHED",
			}),
		})
	})

	it("does nothing when the job already has a PDF, even only the legacy one", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			doc({ claroPdfPath: "claro-pdfs/doc-1-claro.pdf" }) as any,
		)
		await expect(post(pdf())).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("does nothing before the job is released to Finance", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			doc({ releasedToFinanceAt: null }) as any,
		)
		await expect(post(pdf())).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("asks for a file when none was sent", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc() as any)
		await expect(post()).resolves.toEqual({
			errorKey: "docs_review.errors.aviso_pdf_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

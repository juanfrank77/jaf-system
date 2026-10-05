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

	it("404s a crew member who is not assigned to the job", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "crew-9",
			role: "CREW",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("PREPPED", { assignedCrewIds: ["crew-1"] }) as any,
		)

		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 404 })
	})

	it("lets an assigned crew member load the job", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "crew-1",
			role: "CREW",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("PREPPED", { assignedCrewIds: ["crew-1"] }) as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.id).toBe("doc-1")
	})

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

	it("blocks a Crew user from loading an LC_REQUEST_GENERATED doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "CREW",
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

	it("allows an assigned Crew user to load a normal doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "CREW",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("SIGNED", { assignedCrewIds: ["user-1"] }) as any,
		)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("SIGNED")
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

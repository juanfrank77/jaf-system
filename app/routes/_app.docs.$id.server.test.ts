import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
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
		notification: { createMany: vi.fn() },
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		$transaction: vi.fn((ops) => Promise.all(ops)),
		preCertSheet: { findFirst: vi.fn(() => Promise.resolve(null)) },
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireSession: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { loader, reassignToBrigade } from "./_app.docs.$id"

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
		vi.mocked(db.brigade.findMany).mockResolvedValue([{ area: "OESTE" }] as any)

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
		vi.mocked(db.brigade.findMany).mockResolvedValue([{ area: "OESTE" }] as any)
		vi.mocked(db.auditTrail.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1"),
			params: { id: "doc-1" },
		} as any)

		expect(result.doc.status).toBe("FIELD_UPDATED")
	})

	it("allows a Crew user to load a normal doc", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			role: "CREW",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("SIGNED") as any,
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

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		serviceCode: { findMany: vi.fn(() => Promise.resolve([])) },
		user: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			findMany: vi.fn(),
		},
		auditTrail: { findMany: vi.fn() },
		preCertSheet: { findFirst: vi.fn(() => Promise.resolve(null)) },
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireSession: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.docs.$id"

describe("GET /docs/:id", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
	})

	function baseDoc(status = "CREATED") {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status,
			supervisorId: "sup-1",
			assignedCrewIds: [],
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

	it("returns 404 when a supervisor loads another supervisor's job", async () => {
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "sup-b",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED") as any,
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
			id: "sup-1",
			role: "SUPERVISOR",
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc("FIELD_UPDATED") as any,
		)
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

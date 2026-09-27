import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		auditTrail: { create: vi.fn() },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		brigade: { findMany: vi.fn(), findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: any) =>
			fn({
				jafInvoice: { update: vi.fn() },
				auditTrail: { create: vi.fn() },
				user: { findMany: vi.fn(() => Promise.resolve([])) },
				notification: { create: vi.fn() },
			}),
		),
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

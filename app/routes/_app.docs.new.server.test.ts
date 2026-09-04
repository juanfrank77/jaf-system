import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = {
	jafInvoice: { create: vi.fn() },
	auditTrail: { create: vi.fn() },
	notification: { createMany: vi.fn() },
}
vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
		user: { findMany: vi.fn() },
		$transaction: vi.fn(async (fn: any) => fn(tx)),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/control-number.server", () => ({
	generateControlNumber: vi.fn(),
}))
vi.mock("~/lib/service-codes.server", () => ({
	getActiveMaterialCodes: vi.fn(),
}))

import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.docs.new"

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
		vi.mocked(db.brigade.findUniqueOrThrow).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			memberIds: ["crew-1", "crew-2"],
		} as any)
		tx.jafInvoice.create.mockResolvedValue({ id: "doc-1" })
	})

	it("stores description, service lines and the brigade, and fills assignedCrewIds from the brigade", async () => {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		form.set("jobAddressEstimated", "CAM 906 Yabucoa")
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

	it("rejects a missing brigade", async () => {
		const form = new FormData()
		form.set("jobType", "Mantenimiento")
		form.set("jobAddressEstimated", "X")
		form.set("materials", "[]")
		form.set("serviceLines", "[]")
		const res = await action({ request: post(form), params: {} } as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.missing_fields" })
	})

	it("rejects malformed service lines", async () => {
		const form = new FormData()
		form.set("jobType", "M")
		form.set("jobAddressEstimated", "X")
		form.set("brigadeId", "b1")
		form.set("materials", "[]")
		form.set("serviceLines", "{nope")
		const res = await action({ request: post(form), params: {} } as any)
		expect(res).toEqual({ errorKey: "docs_new.errors.invalid_service_lines" })
	})
})

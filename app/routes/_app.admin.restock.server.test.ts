import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		vanRestockRequest: {
			findMany: vi.fn(),
			update: vi.fn(),
		},
		van: {
			findMany: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.admin.restock"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/restock", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("approves a restock request", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "approve")
		form.set("id", "req-1")
		form.set("note", "Approved for emergency")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.vanRestockRequest.update).toHaveBeenCalledWith({
			where: { id: "req-1" },
			data: {
				status: "APPROVED",
				requiresApproval: true,
				approvedById: "admin-1",
				approvalNote: "Approved for emergency",
			},
		})
	})

	it("denies a restock request with a reason", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "deny")
		form.set("id", "req-1")
		form.set("reason", "Exceeds budget")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.vanRestockRequest.update).toHaveBeenCalledWith({
			where: { id: "req-1" },
			data: {
				status: "DENIED",
				requiresApproval: true,
				approvedById: "admin-1",
				deniedReason: "Exceeds budget",
			},
		})
	})

	it("requires a reason for denial", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "deny")
		form.set("id", "req-1")
		form.set("reason", "")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as { init: { status: number }; data: { errorKey: string } }

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "admin_restock.errors.reason_required",
		})
		expect(db.vanRestockRequest.update).not.toHaveBeenCalled()
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		vanRestockRequest: {
			findMany: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
		van: {
			findMany: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		auditTrail: {
			create: vi.fn(),
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
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			id: "req-1",
			status: "PENDING_APPROVAL",
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

	it("allows SUPERVISOR to approve a restock request", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "super-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			id: "req-1",
			status: "PENDING_APPROVAL",
		} as any)
		vi.mocked(db.vanRestockRequest.update).mockResolvedValue({} as any)
		vi.mocked(db.auditTrail.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "approve")
		form.set("id", "req-1")
		form.set("note", "Supervisor approved")

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
				approvedById: "super-1",
				approvalNote: "Supervisor approved",
			},
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "req-1",
				userId: "super-1",
				action: "RESTOCK_APPROVED",
				diffJson: {
					requestId: "req-1",
					note: "Supervisor approved",
					approverId: "super-1",
					approverRole: "SUPERVISOR",
				},
			},
		})
	})

	it("allows SUPERVISOR to deny a restock request with a reason", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "super-1", role: "SUPERVISOR" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			id: "req-1",
			status: "PENDING_APPROVAL",
		} as any)
		vi.mocked(db.vanRestockRequest.update).mockResolvedValue({} as any)
		vi.mocked(db.auditTrail.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "deny")
		form.set("id", "req-1")
		form.set("reason", "Out of stock")

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
				approvedById: "super-1",
				deniedReason: "Out of stock",
			},
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "req-1",
				userId: "super-1",
				action: "RESTOCK_DENIED",
				diffJson: {
					requestId: "req-1",
					reason: "Out of stock",
					approverId: "super-1",
					approverRole: "SUPERVISOR",
				},
			},
		})
	})

	it("rejects non-authorized role for restock actions", async () => {
		vi.mocked(requireRole).mockRejectedValue(new Response(null, { status: 302 }))

		const form = new FormData()
		form.set("intent", "approve")
		form.set("id", "req-1")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r: unknown) => r as Response)) as Response

		expect(result.status).toBe(302)
		expect(db.vanRestockRequest.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("rejects approve when request is not pending approval", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			id: "req-1",
			status: "APPROVED",
		} as any)

		const form = new FormData()
		form.set("intent", "approve")
		form.set("id", "req-1")
		form.set("note", "Approved for emergency")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as { init: { status: number }; data: { errorKey: string } }

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "admin_restock.errors.invalid_status",
		})
		expect(db.vanRestockRequest.update).not.toHaveBeenCalled()
	})

	it("rejects deny when request is not pending approval", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			id: "req-1",
			status: "REQUESTED",
		} as any)

		const form = new FormData()
		form.set("intent", "deny")
		form.set("id", "req-1")
		form.set("reason", "Exceeds budget")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as { init: { status: number }; data: { errorKey: string } }

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "admin_restock.errors.invalid_status",
		})
		expect(db.vanRestockRequest.update).not.toHaveBeenCalled()
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

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		user: {
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
import { action } from "./_app.admin.vans"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/vans", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/vans", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a van", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Van 101")
		form.set("installerId", "installer-1")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.van.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				name: "Van 101",
				installerId: "installer-1",
				active: true,
			}),
		})
	})

	it("allows unassigned installer", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Van 102")
		form.set("installerId", "")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.van.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				installerId: null,
			}),
		})
	})

	it("toggles van active status", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUniqueOrThrow).mockResolvedValue({
			id: "van-1",
			active: true,
		} as any)
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "van-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.van.update).toHaveBeenCalledWith({
			where: { id: "van-1" },
			data: { active: false },
		})
	})

	it("appends history when installerId changes", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			installerId: "installer-old",
			vanAssignmentHistory: [],
		} as any)
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "van-1")
		form.set("name", "Van 101")
		form.set("installerId", "installer-new")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		const updateCall = (db.van.update as any).mock.calls[0][0]
		expect(updateCall.data.installerId).toBe("installer-new")
		expect(updateCall.data.vanAssignmentHistory).toEqual([
			{
				installerId: "installer-new",
				from: "installer-old",
				previousInstallerId: "installer-old",
				assignedAt: expect.any(String),
				to: expect.any(String),
			},
		])
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "van-1",
				userId: "admin-1",
				action: "VAN_ASSIGNMENT_CHANGED",
				diffJson: {
					vanId: "van-1",
					previousInstallerId: "installer-old",
					newInstallerId: "installer-new",
					assignedAt: expect.any(String),
				},
			},
		})
	})

	it("does not duplicate history when installerId is unchanged", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			installerId: "installer-1",
			vanAssignmentHistory: [],
		} as any)
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "van-1")
		form.set("name", "Van 101")
		form.set("installerId", "installer-1")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		const updateCall = (db.van.update as any).mock.calls[0][0]
		expect(updateCall.data.vanAssignmentHistory).toBeUndefined()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("preserves multiple reassignment history entries", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			installerId: "installer-old",
			vanAssignmentHistory: [
				{
					installerId: "installer-mid",
					from: "installer-first",
					to: "2026-08-18T00:00:00Z",
				},
			],
		} as any)
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "van-1")
		form.set("name", "Van 101")
		form.set("installerId", "installer-new")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		const updateCall = (db.van.update as any).mock.calls[0][0]
		expect(updateCall.data.vanAssignmentHistory).toEqual([
			{
				installerId: "installer-mid",
				from: "installer-first",
				to: "2026-08-18T00:00:00Z",
			},
			{
				installerId: "installer-new",
				from: "installer-old",
				previousInstallerId: "installer-old",
				assignedAt: expect.any(String),
				to: expect.any(String),
			},
		])
	})
})

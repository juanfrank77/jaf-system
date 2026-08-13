import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: {
			findMany: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		user: {
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
import { action } from "./_app.admin.vans"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/vans", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/vans", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a van with standard stock levels", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Van 101")
		form.set("installerId", "installer-1")
		form.set("stock_code-a", "10")
		form.set("stock_code-b", "5")
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
				standardStockLevels: expect.arrayContaining([
					{ serviceCodeId: "code-a", qty: 10 },
					{ serviceCodeId: "code-b", qty: 5 },
				]),
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
})

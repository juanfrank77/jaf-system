import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		account: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		$transaction: vi.fn((cb) =>
			cb({
				user: {
					create: vi.fn(async (data: any) => ({
						id: "user-new",
						...data.data,
					})),
				},
				account: {
					create: vi.fn(),
				},
			}),
		),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("better-auth/crypto", () => ({
	hashPassword: vi.fn(async (pwd: string) => `hashed-${pwd}`),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.admin.users"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/users", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/users", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a user with a credential account", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})
		vi.mocked(db.user.findUnique).mockResolvedValue(null)
		const tx = {
			user: {
				create: vi.fn(async () => ({
					id: "user-new",
					email: "test@jaf.com",
					name: "Test",
					role: "CREW",
				})),
			},
			account: { create: vi.fn() },
		}
		vi.mocked(db.$transaction).mockImplementation((cb: any) => cb(tx))

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Test User")
		form.set("email", "test@jaf.com")
		form.set("role", "CREW")
		form.set("tempPassword", "temppass123")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result).toBeInstanceOf(Response)
		expect(result.status).toBe(302)
		expect(result.headers.get("Location")).toBe("/admin/users")
		expect(tx.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				email: "test@jaf.com",
				name: "Test User",
				role: "CREW",
			}),
		})
		expect(tx.account.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ password: "hashed-temppass123" }),
		})
	})

	it("rejects create when email already exists", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})
		vi.mocked(db.user.findUnique).mockResolvedValue({ id: "existing" } as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Test")
		form.set("email", "test@jaf.com")
		form.set("role", "CREW")
		form.set("tempPassword", "temppass123")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result.init.status).toBe(409)
		expect(result.data).toEqual({ errorKey: "admin_users.errors.email_exists" })
	})

	it("toggles user active status", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})
		vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
			id: "user-1",
			active: true,
		} as any)
		vi.mocked(db.user.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "user-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.user.update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { active: false },
		})
	})

	it("prevents self-deactivation", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "admin-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "admin_users.errors.cannot_deactivate_self",
		})
		expect(db.user.update).not.toHaveBeenCalled()
	})

	it("resets password and returns temporary password", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})
		vi.mocked(db.account.findFirst).mockResolvedValue({ id: "acct-1" } as any)
		vi.mocked(db.account.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "resetPassword")
		form.set("id", "user-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result).toHaveProperty("tempPassword")
		expect(typeof (result as any).tempPassword).toBe("string")
		expect((result as any).tempPassword.length).toBeGreaterThanOrEqual(8)
		expect(db.account.update).toHaveBeenCalledWith({
			where: { id: "acct-1" },
			data: expect.objectContaining({
				password: expect.stringContaining("hashed-"),
			}),
		})
	})

	it("updates a user's role", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})
		vi.mocked(db.user.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "updateRole")
		form.set("id", "user-1")
		form.set("role", "FINANCE")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.user.update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { role: "FINANCE" },
		})
	})

	it("prevents changing own role", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {} as any,
		})

		const form = new FormData()
		form.set("intent", "updateRole")
		form.set("id", "admin-1")
		form.set("role", "FINANCE")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "admin_users.errors.cannot_change_own_role",
		})
		expect(db.user.update).not.toHaveBeenCalled()
	})
})

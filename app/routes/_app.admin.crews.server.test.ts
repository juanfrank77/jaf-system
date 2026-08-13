import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: {
			findMany: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.admin.crews"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/crews", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/crews", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a brigade with selected members", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.brigade.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Norte")
		form.append("memberIds", "crew-1")
		form.append("memberIds", "crew-2")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.create).toHaveBeenCalledWith({
			data: {
				name: "Brigada Norte",
				memberIds: ["crew-1", "crew-2"],
				active: true,
			},
		})
	})

	it("updates a brigade", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.brigade.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Brigada Sur")
		form.append("memberIds", "crew-3")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "brigade-1" },
			data: {
				name: "Brigada Sur",
				memberIds: ["crew-3"],
				active: false,
			},
		})
	})

	it("toggles brigade active status", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.brigade.findUniqueOrThrow).mockResolvedValue({
			id: "brigade-1",
			active: true,
		} as any)
		vi.mocked(db.brigade.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "brigade-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "brigade-1" },
			data: { active: false },
		})
	})
})

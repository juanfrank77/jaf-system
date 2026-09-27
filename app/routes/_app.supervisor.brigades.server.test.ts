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

vi.mock("~/lib/supervisor-scope", () => ({
	supervisorAreas: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { supervisorAreas } from "~/lib/supervisor-scope"
import { action, assertBrigadeAreaAllowed } from "./_app.supervisor.brigades"

function formRequest(form: FormData) {
	return new Request("http://localhost/supervisor/brigades", {
		method: "POST",
		body: form,
	})
}

describe("assertBrigadeAreaAllowed", () => {
	it("a supervisor may only create a brigade in one of their own areas", async () => {
		await expect(
			assertBrigadeAreaAllowed({ area: "METRO", supervisorAreas: ["CENTRAL"] }),
		).rejects.toThrow()
		await expect(
			assertBrigadeAreaAllowed({
				area: "CENTRAL",
				supervisorAreas: ["CENTRAL"],
			}),
		).resolves.toBeUndefined()
	})
})

describe("POST /supervisor/brigades", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a brigade with area, supervisorId, and code set, when the area is in scope", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.create).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL")
		form.set("code", "204")
		form.append("memberIds", "crew-1")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.create).toHaveBeenCalledWith({
			data: {
				name: "Brigada Central",
				memberIds: ["crew-1"],
				active: true,
				area: "CENTRAL",
				supervisorId: "sup-1",
				code: "204",
			},
		})
	})

	it("rejects creating a brigade in an area outside the supervisor's scope", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Metro")
		form.set("area", "METRO")
		form.set("code", "205")
		form.set("active", "on")

		await expect(
			action({
				request: formRequest(form),
				params: {},
			} as any),
		).rejects.toThrow()

		expect(db.brigade.create).not.toHaveBeenCalled()
	})
})

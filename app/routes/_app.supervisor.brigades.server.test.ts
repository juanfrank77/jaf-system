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

	it("bootstrap: a supervisor with no brigades yet may use any canonical area", async () => {
		await expect(
			assertBrigadeAreaAllowed({ area: "NORTE", supervisorAreas: [] }),
		).resolves.toBeUndefined()
	})

	it("bootstrap: still rejects a made-up area even with no brigades yet", async () => {
		await expect(
			assertBrigadeAreaAllowed({
				area: "NOT-A-REAL-AREA",
				supervisorAreas: [],
			}),
		).rejects.toThrow()
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
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "crew-1" }] as any)

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

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.area_not_allowed",
		})
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("rejects updating a brigade currently in another area, even when posting one of the supervisor's own areas as the new area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUniqueOrThrow).mockResolvedValue({
			id: "brigade-1",
			area: "METRO",
			active: true,
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([] as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Hijacked Brigade")
		form.set("area", "CENTRAL")
		form.set("code", "999")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.area_not_allowed",
		})
		expect(db.brigade.update).not.toHaveBeenCalled()
	})

	it("rejects creating a brigade with a memberId that isn't a real active CREW user", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.user.findMany).mockResolvedValue([] as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL")
		form.set("code", "204")
		form.append("memberIds", "not-a-real-user")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.invalid_fields",
		})
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("updating a brigade does not overwrite an existing owner's supervisorId with the editing supervisor's id", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-B" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUniqueOrThrow).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-A",
		} as any)
		vi.mocked(db.brigade.update).mockResolvedValue({} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "crew-1" }] as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
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
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "brigade-1" },
			data: {
				name: "Brigada Central",
				memberIds: ["crew-1"],
				active: true,
				area: "CENTRAL",
				code: "204",
			},
		})
	})

	it("returns a translated error instead of throwing when the contractor code collides (P2002)", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "crew-1" }] as any)
		vi.mocked(db.brigade.create).mockRejectedValue(
			Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
		)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL")
		form.set("code", "204")
		form.append("memberIds", "crew-1")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.duplicate_code",
		})
	})

	it("rejects toggling a brigade currently in another area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUniqueOrThrow).mockResolvedValue({
			id: "brigade-1",
			area: "METRO",
			active: true,
		} as any)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "brigade-1")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.area_not_allowed",
		})
		expect(db.brigade.update).not.toHaveBeenCalled()
	})
})

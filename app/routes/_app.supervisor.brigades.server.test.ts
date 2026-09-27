import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
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
import {
	action,
	assertBrigadeAreaAllowed,
	loader,
} from "./_app.supervisor.brigades"

function formRequest(form: FormData) {
	return new Request("http://localhost/supervisor/brigades", {
		method: "POST",
		body: form,
	})
}

describe("assertBrigadeAreaAllowed", () => {
	it("a supervisor may only create a brigade in one of their own (admin-assigned) areas", async () => {
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

	it("is strict when supervisorAreas is empty — no bootstrap or ownership escape hatch", async () => {
		await expect(
			assertBrigadeAreaAllowed({ area: "NORTE", supervisorAreas: [] }),
		).rejects.toThrow()
	})
})

describe("GET /supervisor/brigades", () => {
	beforeEach(() => vi.clearAllMocks())

	it("a supervisor with zero admin-assigned areas sees an empty list and empty areaOptions — never an ALL_AREAS fallback", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-new" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue([])
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/supervisor/brigades"),
			params: {},
		} as any)

		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { area: { in: [] } } }),
		)
		expect(result.areaOptions).toEqual([])
		expect(result.brigades).toEqual([])
	})

	it("scopes the brigade list to the supervisor's admin-assigned areas and surfaces them as areaOptions", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL", "METRO"])
		vi.mocked(db.brigade.findMany).mockResolvedValue([
			{ id: "b1", area: "CENTRAL" },
		] as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])

		const result = await loader({
			request: new Request("http://localhost/supervisor/brigades"),
			params: {},
		} as any)

		expect(db.brigade.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { area: { in: ["CENTRAL", "METRO"] } },
			}),
		)
		expect(result.areaOptions).toEqual(["CENTRAL", "METRO"])
		expect(result.brigades).toEqual([{ id: "b1", area: "CENTRAL" }])
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

	it("rejects a supervisor with zero admin-assigned areas creating anything, even a canonical area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-new" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue([])

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Nueva")
		form.set("area", "NORTE")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("rejects updating a brigade currently in another area, even when posting one of the supervisor's own areas as the new area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
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

	it("CRITICAL regression: rejects updating a brigade's area to one outside the supervisor's own scope, even though they own the brigade and its current area is in scope", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-1",
			memberIds: [],
		} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Brigada Central")
		// posts a foreign area as the NEW area for a brigade they currently own
		form.set("area", "METRO")
		form.set("code", "204")
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

	it("rejects a supervisor changing the area of a brigade owned by a different (co-area) supervisor", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-B" },
			session: {},
		} as any)
		// sup-B holds both CENTRAL and NORTE — enough to open a CENTRAL
		// brigade they don't own and try to move it to NORTE.
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL", "NORTE"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-A",
			memberIds: [],
		} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Brigada Central")
		form.set("area", "NORTE")
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

	it("allows the brigade's actual owner to move it between their own areas", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-A" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL", "NORTE"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-A",
			memberIds: [],
		} as any)
		vi.mocked(db.brigade.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Brigada Central")
		form.set("area", "NORTE")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ area: "NORTE" }),
			}),
		)
	})

	it("rejects intent=update with a blank id instead of silently creating a brigade", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])

		const form = new FormData()
		form.set("intent", "update")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL")
		form.set("active", "on")
		// no "id" field at all

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "supervisor_brigades.errors.id_required",
		})
		expect(db.brigade.create).not.toHaveBeenCalled()
		expect(db.brigade.findUnique).not.toHaveBeenCalled()
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
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-A",
			memberIds: [],
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
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
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

	it("CRITICAL regression: a supervisor with zero admin-assigned areas cannot update a brigade they don't own", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-new" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue([])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-victim",
			area: "NORTE",
			active: true,
			supervisorId: "sup-other",
			memberIds: ["crew-old"],
		} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-victim")
		form.set("name", "Hijacked")
		form.set("area", "NORTE")
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

	it("CRITICAL regression: a supervisor with zero admin-assigned areas cannot toggle a brigade they don't own", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-new" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue([])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-victim",
			area: "NORTE",
			active: true,
			supervisorId: "sup-other",
		} as any)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "brigade-victim")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(db.brigade.update).not.toHaveBeenCalled()
	})

	it("a supervisor with zero admin-assigned areas cannot update even their own brigade — ownership no longer grants scope", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue([])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-own",
			area: null,
			active: true,
			supervisorId: "sup-1",
			memberIds: [],
		} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-own")
		form.set("name", "My Own Brigade")
		form.set("area", "NORTE")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(403)
		expect(db.brigade.update).not.toHaveBeenCalled()
	})

	it("returns a clean 400 (not a 500) when updating a brigade id that doesn't exist", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "does-not-exist")
		form.set("name", "Whatever")
		form.set("area", "CENTRAL")
		form.set("active", "on")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(400)
		expect(db.brigade.update).not.toHaveBeenCalled()
	})

	it("returns a clean 400 (not a 500) when toggling a brigade id that doesn't exist", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)

		const form = new FormData()
		form.set("intent", "toggle")
		form.set("id", "does-not-exist")

		const result = (await action({
			request: formRequest(form),
			params: {},
		} as any)) as any

		expect(result.init.status).toBe(400)
		expect(db.brigade.update).not.toHaveBeenCalled()
	})

	it("updating a brigade does not re-validate members that were already on it (only newly added ones)", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "brigade-1",
			area: "CENTRAL",
			active: true,
			supervisorId: "sup-1",
			memberIds: ["crew-deactivated"],
		} as any)
		vi.mocked(db.brigade.update).mockResolvedValue({} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([] as any) // no active CREW users at all

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "brigade-1")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL")
		// resubmits the pre-existing (now-deactivated) member, no new ones added
		form.append("memberIds", "crew-deactivated")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.update).toHaveBeenCalled()
	})

	it("trims the submitted area before comparing, so trailing whitespace doesn't produce an orphaned area", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1" },
			session: {},
		} as any)
		vi.mocked(supervisorAreas).mockResolvedValue(["CENTRAL"])
		vi.mocked(db.brigade.create).mockResolvedValue({} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([] as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Brigada Central")
		form.set("area", "CENTRAL ")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.brigade.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ area: "CENTRAL" }),
		})
	})
})

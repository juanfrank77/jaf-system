import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		brigade: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		user: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/contractor-account-sync", () => ({
	syncContractorAccount: vi.fn(),
}))

import { syncContractorAccount } from "~/lib/contractor-account-sync"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.comptroller.brigades"

const request = (form?: FormData) =>
	new Request("http://localhost/comptroller/brigades", {
		method: form ? "POST" : "GET",
		body: form,
	})

function formOf(fields: Record<string, string>, members: string[] = []) {
	const form = new FormData()
	for (const [k, v] of Object.entries(fields)) form.set(k, v)
	for (const m of members) form.append("memberIds", m)
	return form
}

const run = (form: FormData) =>
	action({ request: request(form), params: {} } as any).catch(
		(r) => r,
	) as Promise<any>

describe("/comptroller/brigades", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "carmen" },
			session: {},
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "crew-1" }] as any)
		vi.mocked(db.brigade.create).mockResolvedValue({ id: "b1" } as any)
		vi.mocked(db.brigade.update).mockResolvedValue({ id: "b1" } as any)
	})

	it("is open to the Comptroller and Admin, not to supervisors", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([])
		await loader({ request: request(), params: {} } as any)
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), [
			"COMPTROLLER",
			"ADMIN",
		])
	})

	it("lists every brigade, in every area", async () => {
		vi.mocked(db.brigade.findMany).mockResolvedValue([{ id: "b1" }] as any)
		const result = (await loader({
			request: request(),
			params: {},
		} as any)) as any
		expect(db.brigade.findMany).toHaveBeenCalledWith({
			orderBy: { name: "asc" },
		})
		expect(result.areaOptions).toEqual([
			"CENTRAL",
			"METRO",
			"NORTE",
			"OESTE",
			"SUR",
		])
	})

	it("creates a brigade and syncs its contractor account", async () => {
		const result = await run(
			formOf(
				{
					intent: "create",
					name: "Brigada Central",
					area: "CENTRAL",
					code: "204",
					active: "on",
				},
				["crew-1"],
			),
		)
		expect(result.status).toBe(302)
		expect(db.brigade.create).toHaveBeenCalledWith({
			data: {
				name: "Brigada Central",
				memberIds: ["crew-1"],
				active: true,
				area: "CENTRAL",
				code: "204",
			},
		})
		expect(syncContractorAccount).toHaveBeenCalledWith(db, { id: "b1" })
	})

	it("rejects an area outside the canonical set", async () => {
		const result = await run(
			formOf({ intent: "create", name: "X", area: "MARS" }),
		)
		expect(result.init.status).toBe(400)
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("trims the area before checking it", async () => {
		const result = await run(
			formOf({ intent: "create", name: "X", area: " SUR " }),
		)
		expect(result.status).toBe(302)
		expect(db.brigade.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ area: "SUR" }),
		})
	})

	it("rejects a new member who is not an active CREW user", async () => {
		vi.mocked(db.user.findMany).mockResolvedValue([])
		const result = await run(
			formOf({ intent: "create", name: "X", area: "SUR" }, ["ghost"]),
		)
		expect(result.init.status).toBe(400)
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("updates an existing brigade without re-validating members already on it", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			memberIds: ["old"],
		} as any)
		const result = await run(
			formOf({ intent: "update", id: "b1", name: "X", area: "SUR" }, ["old"]),
		)
		expect(result.status).toBe(302)
		expect(db.user.findMany).not.toHaveBeenCalled()
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "b1" },
			data: expect.objectContaining({ memberIds: ["old"], area: "SUR" }),
		})
	})

	it("leaves the active flag alone on update, even if the form omits it", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			memberIds: [],
			active: true,
		} as any)
		await run(formOf({ intent: "update", id: "b1", name: "X", area: "SUR" }))
		const { data } = vi.mocked(db.brigade.update).mock.calls[0][0] as any
		expect(data).not.toHaveProperty("active")
	})

	it("rejects an update with a blank or unknown id instead of creating", async () => {
		const blank = await run(
			formOf({ intent: "update", id: " ", name: "X", area: "SUR" }),
		)
		expect(blank.init.status).toBe(400)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)
		const unknown = await run(
			formOf({ intent: "update", id: "nope", name: "X", area: "SUR" }),
		)
		expect(unknown.init.status).toBe(400)
		expect(db.brigade.create).not.toHaveBeenCalled()
	})

	it("returns a translated error when the contractor code collides (P2002)", async () => {
		vi.mocked(db.brigade.create).mockRejectedValue(
			Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
		)
		const result = await run(
			formOf({ intent: "create", name: "X", area: "SUR", code: "204" }),
		)
		expect(result.init.status).toBe(400)
		expect(result.data).toEqual({
			errorKey: "comptroller_brigades.errors.duplicate_code",
		})
	})

	it("toggles a brigade active/inactive and keeps its contractor account in step", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			active: true,
		} as any)
		const toggled = { id: "b1", active: false }
		vi.mocked(db.brigade.update).mockResolvedValue(toggled as any)
		const result = await run(formOf({ intent: "toggle", id: "b1" }))
		expect(result.status).toBe(302)
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "b1" },
			data: { active: false },
		})
		expect(syncContractorAccount).toHaveBeenCalledWith(db, toggled)
	})

	it("returns 400 when toggling a brigade that does not exist", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)
		const result = await run(formOf({ intent: "toggle", id: "nope" }))
		expect(result.init.status).toBe(400)
	})
})

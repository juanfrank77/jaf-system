import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		claroSupervisor: {
			findMany: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.admin.claro-supervisors"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/claro-supervisors", {
		method: "POST",
		body: form,
	})
}

const run = (form: FormData) =>
	action({ request: formRequest(form), params: {} } as any).catch((r) => r)

describe("/admin/claro-supervisors", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
	})

	it("create persists name, email and flags", async () => {
		vi.mocked(db.claroSupervisor.create).mockResolvedValue({} as any)
		const form = new FormData()
		form.set("intent", "create")
		form.set("name", " Ana Ruiz ")
		form.set("email", "ana@claro.com")
		form.set("requiresPrefield", "on")
		form.append("jafSupervisorIds", "jaf-1")
		form.append("jafSupervisorIds", "jaf-2")
		const result = await run(form)
		expect(result.status).toBe(302)
		expect(db.claroSupervisor.create).toHaveBeenCalledWith({
			data: {
				name: "Ana Ruiz",
				email: "ana@claro.com",
				requiresPrefield: true,
				requiresBlueprint: false,
				jafSupervisors: { connect: [{ id: "jaf-1" }, { id: "jaf-2" }] },
			},
		})
	})

	it("create rejects an invalid email with 400", async () => {
		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Ana")
		form.set("email", "not-an-email")
		const result = await run(form)
		expect(result.init.status).toBe(400)
		expect(result.data.errorKey).toBe("claro_supervisors.errors.invalid_email")
		expect(db.claroSupervisor.create).not.toHaveBeenCalled()
	})

	it("update changes the email", async () => {
		vi.mocked(db.claroSupervisor.update).mockResolvedValue({} as any)
		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "cs-1")
		form.set("name", "Ana")
		form.set("email", "new@claro.com")
		form.set("requiresBlueprint", "on")
		form.append("jafSupervisorIds", "jaf-1")
		const result = await run(form)
		expect(result.status).toBe(302)
		expect(db.claroSupervisor.update).toHaveBeenCalledWith({
			where: { id: "cs-1" },
			data: {
				name: "Ana",
				email: "new@claro.com",
				requiresPrefield: false,
				requiresBlueprint: true,
				jafSupervisors: { set: [{ id: "jaf-1" }] },
			},
		})
	})

	it("toggle_active flips active", async () => {
		vi.mocked(db.claroSupervisor.findUniqueOrThrow).mockResolvedValue({
			id: "cs-1",
			active: true,
		} as any)
		vi.mocked(db.claroSupervisor.update).mockResolvedValue({} as any)
		const form = new FormData()
		form.set("intent", "toggle_active")
		form.set("id", "cs-1")
		const result = await run(form)
		expect(result.status).toBe(302)
		expect(db.claroSupervisor.update).toHaveBeenCalledWith({
			where: { id: "cs-1" },
			data: { active: false },
		})
	})

	it("rejects non-ADMIN via requireRole", async () => {
		vi.mocked(requireRole).mockRejectedValue(
			new Response(null, { status: 403 }),
		)
		const form = new FormData()
		form.set("intent", "create")
		const result = await run(form)
		expect(result.status).toBe(403)
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), ["ADMIN"])
		expect(db.claroSupervisor.create).not.toHaveBeenCalled()
		await expect(
			loader({ request: formRequest(form), params: {} } as any),
		).rejects.toBeInstanceOf(Response)
	})
})

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
		serviceCode: {
			findMany: vi.fn(),
		},
		auditTrail: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
			const { db: client } = await import("~/lib/db.server")
			return fn(client)
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/van-stock.server", () => ({
	setVanParLevels: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { setVanParLevels } from "~/lib/van-stock.server"
import { action } from "./_app.admin.vans"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/vans", {
		method: "POST",
		body: form,
	})
}

describe("POST /admin/vans", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a van with empty legacy JSON then writes par levels", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({ id: "van-new" } as any)
		vi.mocked(setVanParLevels).mockResolvedValue([
			{ serviceCodeId: "code-a", parLevel: 10 },
			{ serviceCodeId: "code-b", parLevel: 5 },
		])

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
		expect(db.$transaction).toHaveBeenCalledTimes(1)
		expect(db.van.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				name: "Van 101",
				installerId: "installer-1",
				standardStockLevels: [],
				active: true,
			}),
		})
		expect(setVanParLevels).toHaveBeenCalledWith(
			"van-new",
			[
				{ serviceCodeId: "code-a", parLevel: 10 },
				{ serviceCodeId: "code-b", parLevel: 5 },
			],
			"create",
			expect.anything(),
		)
	})

	it("allows unassigned installer", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({ id: "van-new" } as any)

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
		expect(setVanParLevels).not.toHaveBeenCalled()
	})

	it("accepts par level of zero", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.create).mockResolvedValue({ id: "van-new" } as any)
		vi.mocked(setVanParLevels).mockResolvedValue([
			{ serviceCodeId: "code-a", parLevel: 0 },
		])

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Van Zero")
		form.set("stock_code-a", "0")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(setVanParLevels).toHaveBeenCalledWith(
			"van-new",
			[{ serviceCodeId: "code-a", parLevel: 0 }],
			"create",
			expect.anything(),
		)
	})

	it("rejects negative par levels", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "create")
		form.set("name", "Van Bad")
		form.set("stock_code-a", "-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect((result as any).init?.status).toBe(400)
		expect((result as any).data.errorKey).toBe("admin_vans.errors.negative_par")
		expect(db.van.create).not.toHaveBeenCalled()
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

	it("preserves inactive service code stock levels on update via setVanParLevels", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			installerId: "installer-1",
		} as any)
		vi.mocked(setVanParLevels).mockResolvedValue([
			{ serviceCodeId: "inactive-code", parLevel: 4 },
			{ serviceCodeId: "active-code", parLevel: 3 },
		])
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "van-1")
		form.set("name", "Van 101")
		form.set("installerId", "installer-1")
		form.set("stock_active-code", "3")
		form.set("active", "on")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(result.status).toBe(302)
		expect(db.$transaction).toHaveBeenCalledTimes(1)
		expect(setVanParLevels).toHaveBeenCalledWith(
			"van-1",
			[{ serviceCodeId: "active-code", parLevel: 3 }],
			"update",
			expect.anything(),
		)
		expect(db.van.update).toHaveBeenCalledWith({
			where: { id: "van-1" },
			data: expect.objectContaining({
				name: "Van 101",
				installerId: "installer-1",
				active: true,
			}),
		})
	})

	it("dual-writes legacy JSON inside setVanParLevels on update", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			installerId: "installer-1",
		} as any)
		const merged = [
			{ serviceCodeId: "sc-1", parLevel: 2 },
			{ serviceCodeId: "sc-2", parLevel: 5 },
		]
		vi.mocked(setVanParLevels).mockResolvedValue(merged)
		vi.mocked(db.van.update).mockResolvedValue({} as any)

		const form = new FormData()
		form.set("intent", "update")
		form.set("id", "van-1")
		form.set("name", "Van 101")
		form.set("installerId", "installer-1")
		form.set("stock_sc-2", "5")

		await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r) => r)

		expect(setVanParLevels).toHaveBeenCalled()
		const { stockLevelsToLegacyJson } = await import("~/lib/van-stock")
		expect(stockLevelsToLegacyJson(merged)).toEqual([
			{ serviceCodeId: "sc-1", qty: 2 },
			{ serviceCodeId: "sc-2", qty: 5 },
		])
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
		vi.mocked(setVanParLevels).mockResolvedValue([])
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
		expect(db.van.update).toHaveBeenCalled()
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
		vi.mocked(setVanParLevels).mockResolvedValue([])
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
		vi.mocked(setVanParLevels).mockResolvedValue([])
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
		const historyUpdate = (db.van.update as any).mock.calls.find(
			(call: any) => call[0].data.vanAssignmentHistory,
		)
		expect(historyUpdate?.[0].data.vanAssignmentHistory).toEqual([
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

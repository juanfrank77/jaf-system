import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: {
			findUnique: vi.fn(),
		},
		warehouse: {
			findUnique: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		vanRestockRequest: {
			findMany: vi.fn(),
			create: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		$queryRaw: vi.fn(),
		$transaction: vi.fn(async (ops: any[]) => {
			for (const op of ops) {
				if (typeof op === "function") {
					await op({
						vanRestockRequest: { create: vi.fn() },
						notification: { create: vi.fn() },
					})
				}
			}
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.installer.restock"

function formRequest(form: FormData) {
	return new Request("http://localhost/installer/restock", {
		method: "POST",
		body: form,
	})
}

describe("POST /installer/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseVan(standard = 5) {
		return {
			id: "van-1",
			name: "Van 1",
			standardStockLevels: [{ serviceCodeId: "sc-1", qty: standard }],
		}
	}

	it("creates a within-standard request straight to REQUESTED", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)
		vi.mocked(db.$queryRaw).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 0 },
		] as any)
		vi.mocked(db.vanRestockRequest.findMany).mockResolvedValue([])
		vi.mocked(db.vanRestockRequest.create).mockResolvedValue({
			id: "req-1",
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]))

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(db.vanRestockRequest.create).toHaveBeenCalled()
		const createCall = vi.mocked(db.vanRestockRequest.create).mock.calls[0][0]
		expect(createCall.data.status).toBe("REQUESTED")
		expect(createCall.data.requiresApproval).toBe(false)
	})

	it("creates an above-standard request as PENDING_APPROVAL", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)
		vi.mocked(db.$queryRaw).mockResolvedValue([
			{ serviceCodeId: "sc-1", qty: 0 },
		] as any)
		vi.mocked(db.vanRestockRequest.findMany).mockResolvedValue([])
		vi.mocked(db.vanRestockRequest.create).mockResolvedValue({
			id: "req-1",
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 6 }]))

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		const createCall = vi.mocked(db.vanRestockRequest.create).mock.calls[0][0]
		expect(createCall.data.status).toBe("PENDING_APPROVAL")
		expect(createCall.data.requiresApproval).toBe(true)
	})

	it("rejects restock when service code does not exist", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([])
		vi.mocked(db.$queryRaw).mockResolvedValue([])
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("items", JSON.stringify([{ serviceCodeId: "bad-code", qty: 3 }]))

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect((result as any).init?.status).toBe(400)
		expect((result as any).data.errorKey).toBe(
			"installer_restock.errors.invalid_service_codes",
		)
	})

	it("returns 409 when van is inactive during offline sync", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 1",
			active: false,
		} as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)

		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]))

		const request = new Request("http://localhost/installer/restock", {
			method: "POST",
			body: form,
			headers: { "X-Offline-Sync": "true" },
		})

		const result = (await action({
			request,
			params: {},
		} as any)) as { init: { status: number }; data: { conflict: string } }

		expect(result.init.status).toBe(409)
		expect(result.data).toEqual({ conflict: "VAN_INACTIVE" })
	})

	it("returns 409 when warehouse is inactive during offline sync", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
			name: "Van 1",
			active: true,
		} as any)
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			active: false,
		} as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)

		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]))

		const request = new Request("http://localhost/installer/restock", {
			method: "POST",
			body: form,
			headers: { "X-Offline-Sync": "true" },
		})

		const result = (await action({
			request,
			params: {},
		} as any)) as { init: { status: number }; data: { conflict: string } }

		expect(result.init.status).toBe(409)
		expect(result.data).toEqual({ conflict: "WAREHOUSE_INACTIVE" })
	})
})

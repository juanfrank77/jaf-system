import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		van: {
			findUnique: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		vanInventoryTransaction: {
			findMany: vi.fn(),
			createMany: vi.fn(),
		},
		installLog: {
			create: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (fn: any) => {
			if (typeof fn === "function") {
				return fn({
					installLog: { create: vi.fn(() => ({ id: "log-1" })) },
					vanInventoryTransaction: {
						findMany: vi.fn(),
						createMany: vi.fn(),
					},
					notification: { create: vi.fn() },
					user: { findMany: vi.fn(() => []) },
					$queryRaw: vi.fn(),
				})
			}
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.installer.install"

function formRequest(form: FormData) {
	return new Request("http://localhost/installer/install", {
		method: "POST",
		body: form,
	})
}

describe("POST /installer/install", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseVan() {
		return {
			id: "van-1",
			name: "Van 1",
			standardStockLevels: [{ serviceCodeId: "sc-1", qty: 5 }],
		}
	}

	it("logs an install and deducts materials from van inventory", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)
		vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
			return fn({
				installLog: {
					create: vi.fn(() => ({ id: "log-1" })),
				},
				vanInventoryTransaction: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ serviceCodeId: "sc-1", qty: 5, type: "RESTOCK" },
						] as any),
					createMany: vi.fn(),
				},
				notification: { create: vi.fn() },
				user: { findMany: vi.fn(() => []) },
				$queryRaw: vi
					.fn()
					.mockResolvedValue([{ serviceCodeId: "sc-1", qty: 5 }]),
			})
		})

		const form = new FormData()
		form.set("claroJobReference", "12345678")
		form.set("serviceType", "WIFI")
		form.set("date", "2026-08-13")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
	})

	it("flags discrepancy when install uses more than on hand", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)

		const createLog = vi.fn(() => ({ id: "log-1" }))
		vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
			return fn({
				installLog: { create: createLog },
				vanInventoryTransaction: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ serviceCodeId: "sc-1", qty: 1, type: "RESTOCK" },
						] as any),
					createMany: vi.fn(),
				},
				notification: { create: vi.fn() },
				user: { findMany: vi.fn().mockResolvedValue([]) },
				$queryRaw: vi
					.fn()
					.mockResolvedValue([{ serviceCodeId: "sc-1", qty: 1 }]),
			})
		})

		const form = new FormData()
		form.set("claroJobReference", "12345678")
		form.set("serviceType", "WIFI")
		form.set("date", "2026-08-13")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))

		await action({
			request: formRequest(form),
			params: {},
		} as any).catch(() => {})

		expect(createLog).toHaveBeenCalled()
		const firstCall = createLog.mock.calls[0] as unknown[]
		const data = (firstCall[0] as { data: { discrepancyFlagged: boolean } })
			.data
		expect(data.discrepancyFlagged).toBe(true)
	})

	it("rejects install when service code does not exist", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue(baseVan() as any)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([])

		const form = new FormData()
		form.set("claroJobReference", "12345678")
		form.set("serviceType", "WIFI")
		form.set("date", "2026-08-13")
		form.set("items", JSON.stringify([{ serviceCodeId: "bad-code", qty: 2 }]))

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect((result as any).init?.status).toBe(400)
		expect((result as any).data.errorKey).toBe(
			"installer_install.errors.invalid_service_codes",
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
		form.set("claroJobReference", "12345678")
		form.set("serviceType", "WIFI")
		form.set("date", "2026-08-13")
		form.set("items", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))

		const request = new Request("http://localhost/installer/install", {
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
})

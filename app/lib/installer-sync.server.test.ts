import { beforeEach, describe, expect, it, vi } from "vitest"

import { syncInstallerInstall, syncInstallerRestock } from "./installer-sync"

const originalFetch = globalThis.fetch

function baseRestockPayload() {
	return {
		warehouseId: "wh-1",
		items: [{ serviceCodeId: "sc-1", qty: 2 }],
	}
}

function baseInstallPayload() {
	return {
		claroJobReference: "JOB-1",
		serviceType: "CABLE_TV",
		date: "2026-08-15",
		items: [{ serviceCodeId: "sc-1", qty: 1 }],
		notes: "Test install",
	}
}

describe("installer-sync", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		globalThis.fetch = vi.fn()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	describe("syncInstallerRestock", () => {
		it("returns ok:true when server responds 200", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: true,
				status: 200,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerRestock({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_RESTOCK",
				payload: baseRestockPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({ ok: true })
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"/installer/restock",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({ "X-Offline-Sync": "true" }),
				}),
			)
		})

		it("returns conflict when server responds 409 with VAN_INACTIVE", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: false,
				status: 409,
				json: async () => ({ conflict: "VAN_INACTIVE" }),
				text: async () => "{}",
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerRestock({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_RESTOCK",
				payload: baseRestockPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({
				ok: false,
				conflict: {
					type: "VAN_INACTIVE",
					message:
						"Your van is no longer active. Please contact your supervisor.",
				},
			})
		})

		it("returns conflict when server responds 409 with WAREHOUSE_INACTIVE", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: false,
				status: 409,
				json: async () => ({ conflict: "WAREHOUSE_INACTIVE" }),
				text: async () => "{}",
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerRestock({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_RESTOCK",
				payload: baseRestockPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({
				ok: false,
				conflict: {
					type: "WAREHOUSE_INACTIVE",
					message: "The selected warehouse is no longer available.",
				},
			})
		})

		it("returns error on network failure", async () => {
			vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network down"))

			const result = await syncInstallerRestock({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_RESTOCK",
				payload: baseRestockPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({
				ok: false,
				error: "Network down",
			})
		})
	})

	describe("syncInstallerInstall", () => {
		it("returns ok:true when server responds 200", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: true,
				status: 200,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerInstall({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_INSTALL",
				payload: baseInstallPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({ ok: true })
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"/installer/install",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({ "X-Offline-Sync": "true" }),
				}),
			)
		})

		it("returns conflict when server responds 409 with VAN_INACTIVE", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: false,
				status: 409,
				json: async () => ({ conflict: "VAN_INACTIVE" }),
				text: async () => "{}",
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerInstall({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_INSTALL",
				payload: baseInstallPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({
				ok: false,
				conflict: {
					type: "VAN_INACTIVE",
					message:
						"Your van is no longer active. Please contact your supervisor.",
				},
			})
		})

		it("returns error when response is not ok and not a known conflict", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				redirected: false,
				ok: false,
				status: 500,
				text: async () => "Server error",
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)

			const result = await syncInstallerInstall({
				id: "action-1",
				docId: undefined,
				action: "INSTALLER_INSTALL",
				payload: baseInstallPayload(),
				createdAt: new Date().toISOString(),
			})

			expect(result).toEqual({
				ok: false,
				error: "Server error",
			})
		})
	})
})

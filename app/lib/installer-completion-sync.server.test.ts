import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queueCompletion, syncOne } from "./installer-completion-sync"
import type { QueuedAction } from "./offline-store"

const originalFetch = globalThis.fetch

vi.mock("./offline-store", async () => {
	const actual =
		await vi.importActual<typeof import("./offline-store")>("./offline-store")
	return { ...actual, queueAction: vi.fn().mockResolvedValue({}) }
})

function baseAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
	return {
		id: "a1",
		action: "INSTALLER_COMPLETION",
		payload: { claroOrderNo: "1" },
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

describe("queueCompletion", () => {
	it("queues a completion action", async () => {
		const { queueAction } = await import("./offline-store")
		await queueCompletion({ claroOrderNo: "1" })
		expect(queueAction).toHaveBeenCalledWith({
			docId: undefined,
			action: "INSTALLER_COMPLETION",
			payload: { claroOrderNo: "1" },
		})
	})
})

describe("syncOne", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn()
	})
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("returns ok:true when the server responds 200", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: true,
			status: 200,
		} as Response)
		const result = await syncOne(baseAction())
		expect(result).toEqual({ ok: true })
	})

	it("reports a conflict when the server returns 409", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: false,
			status: 409,
			json: async () => ({ conflict: "VAN_INACTIVE" }),
		} as Response)
		const result = await syncOne(baseAction())
		expect(result.ok).toBe(false)
		expect(result.conflict?.type).toBe("VAN_INACTIVE")
	})
})

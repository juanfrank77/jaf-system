import { beforeEach, describe, expect, it, vi } from "vitest"

import { type FieldUpdatePayload, syncFieldUpdate } from "./field-sync"

const originalFetch = globalThis.fetch

function basePayload(
	overrides: Partial<FieldUpdatePayload> = {},
): FieldUpdatePayload {
	return {
		jobAddressActual: "123 Calle Sol",
		materialsUsed: "[]",
		completionSignature: "data:image/png;base64,abc",
		...overrides,
	}
}

function baseCachedJob(
	overrides: { status?: string; assignedCrewIds?: string[] } = {},
): any {
	return {
		id: "doc-1",
		controlNumber: "JAF-1001",
		status: overrides.status ?? "SIGNED",
		jobType: "INSTALL",
		jobAddressEstimated: "Cupey, San Juan",
		assignedCrewIds: overrides.assignedCrewIds ?? ["crew-1"],
		updatedAt: new Date().toISOString(),
	}
}

describe("syncFieldUpdate", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		globalThis.fetch = vi.fn()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("returns ok:true when server responds 200", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: true,
			status: 200,
		} as any)

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({ ok: true })
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"/docs/doc-1/field",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "X-Offline-Sync": "true" }),
			}),
		)
	})

	it("returns conflict when server responds 409 with CANCELLED", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: false,
			status: 409,
			json: async () => ({ conflict: "CANCELLED" }),
			text: async () => "{}",
		} as any)

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({
			ok: false,
			conflict: {
				type: "CANCELLED",
				docId: "doc-1",
				message: "This job was cancelled while you were offline.",
			},
		})
	})

	it("returns conflict when server responds 409 with REASSIGNED", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: false,
			status: 409,
			json: async () => ({ conflict: "REASSIGNED" }),
			text: async () => "{}",
		} as any)

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({
			ok: false,
			conflict: {
				type: "REASSIGNED",
				docId: "doc-1",
				message: "This job was reassigned or modified while you were offline.",
			},
		})
	})

	it("returns conflict when server responds 409 without body", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: false,
			status: 409,
			json: async () => ({}),
			text: async () => "{}",
		} as any)

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({
			ok: false,
			conflict: {
				type: "REASSIGNED",
				docId: "doc-1",
				message: "This job was reassigned or modified while you were offline.",
			},
		})
	})

	it("returns error on network failure", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network down"))

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({
			ok: false,
			error: "Network down",
		})
	})

	it("returns error when response is not ok and not a known conflict", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			redirected: false,
			ok: false,
			status: 500,
			text: async () => "Server error",
		} as any)

		const result = await syncFieldUpdate(
			{
				id: "action-1",
				docId: "doc-1",
				action: "FIELD_UPDATE",
				payload: basePayload(),
				createdAt: new Date().toISOString(),
			},
			baseCachedJob(),
		)

		expect(result).toEqual({
			ok: false,
			error: "Server error",
		})
	})
})

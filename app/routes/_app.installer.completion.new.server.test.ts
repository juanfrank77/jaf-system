import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	submitCompletion: vi.fn(),
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/completion-submit.server", () => ({
	submitCompletion: mocks.submitCompletion,
}))

import { action } from "./_app.installer.completion.new"

function offlineRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/installer/completion/new", {
		method: "POST",
		body: form,
		headers: { "X-Offline-Sync": "true" },
	})
}

describe("POST /installer/completion/new", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns 409 with a conflict when the installer's van is inactive (offline sync)", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: false },
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = (await action({
			request: req,
			params: {},
			context: {},
		} as never)) as { init: { status: number } | null; data: unknown }
		expect(res.init?.status).toBe(409)
		expect(mocks.submitCompletion).not.toHaveBeenCalled()
	})

	it("submits and returns the result JSON when offline-synced and the van is active", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			profile: { id: "p1" },
			van: { id: "van-1", active: true },
		})
		mocks.submitCompletion.mockResolvedValue({
			completionId: "c1",
			paymentRequestId: "pr1",
			status: "READY",
		})
		const req = offlineRequest({
			idempotencyKey: "k1",
			claroOrderNo: "430920",
			address: "a",
			serialUnreadable: "true",
			accessories: "[]",
		})
		const res = (await action({
			request: req,
			params: {},
			context: {},
		} as never)) as { init: { status: number } | null; data: unknown }
		expect(res.init?.status).toBe(200)
		expect(res.data).toEqual({
			ok: true,
			completionId: "c1",
			paymentRequestId: "pr1",
			status: "READY",
		})
	})
})

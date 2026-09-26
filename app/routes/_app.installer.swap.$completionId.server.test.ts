import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireInstaller: vi.fn(),
	submitSwap: vi.fn(),
	db: {
		user: { findMany: vi.fn().mockResolvedValue([]) },
		notification: { create: vi.fn() },
		$transaction: vi.fn(),
	},
}))

vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/swap-submit.server", () => ({ submitSwap: mocks.submitSwap }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { action } from "./_app.installer.swap.$completionId"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/installer/swap/c1", {
		method: "POST",
		body: form,
	})
}

describe("POST /installer/swap/:completionId", () => {
	beforeEach(() => vi.clearAllMocks())

	it("submits the swap and notifies installer supervisors + warehouse", async () => {
		mocks.requireInstaller.mockResolvedValue({
			user: { id: "inst-1" },
			van: { id: "van-1" },
		})
		mocks.submitSwap.mockResolvedValue({
			swapId: "sw1",
			paymentRequestId: "pr1",
		})
		mocks.db.user.findMany.mockResolvedValue([{ id: "sup-1" }])

		const req = formRequest({
			serialOut: "OUT1",
			reason: "HARDWARE",
			serialIn: "IN1",
			newClaroOrderNo: "",
		})
		const res = await action({
			request: req,
			params: { completionId: "c1" },
		} as never)

		expect(mocks.submitSwap).toHaveBeenCalledWith(
			expect.objectContaining({
				completionId: "c1",
				serialOut: "OUT1",
				reason: "HARDWARE",
				serialIn: "IN1",
				newClaroOrderNo: undefined,
				installerId: "inst-1",
				vanId: "van-1",
			}),
			{ id: "inst-1" },
		)
		expect((res as Response).status).toBe(302)
	})
})

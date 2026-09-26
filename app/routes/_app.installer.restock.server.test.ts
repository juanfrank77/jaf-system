import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	requireInstaller: vi.fn(),
	createRestock: vi.fn(),
	db: {
		restockRequest: { updateMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/restock.server", () => ({ createRestock: mocks.createRestock }))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { action } from "./_app.installer.restock"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/installer/restock", {
		method: "POST",
		body: form,
	})
}

describe("POST /installer/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("an installer cannot approve — redirects without updating", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		const req = formRequest({ intent: "approve", id: "r1" })
		await action({ request: req, params: {} } as never).catch(() => {})
		expect(mocks.db.restockRequest.updateMany).not.toHaveBeenCalled()
	})

	it("an installer supervisor can approve a restock awaiting sign-off", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		mocks.db.restockRequest.updateMany.mockResolvedValue({ count: 1 })
		const req = formRequest({ intent: "approve", id: "r1" })
		await action({ request: req, params: {} } as never).catch(() => {})
		expect(mocks.db.restockRequest.updateMany).toHaveBeenCalledWith({
			where: { id: "r1", status: "NEEDS_SIGNOFF" },
			data: { status: "APPROVED", approvedById: "sup-1" },
		})
	})

	it("rejects a double-approve on a restock no longer awaiting sign-off", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		mocks.db.restockRequest.updateMany.mockResolvedValue({ count: 0 })
		const req = formRequest({ intent: "approve", id: "r1" })
		const res = await action({ request: req, params: {} } as never)
		expect((res as Response).status).toBe(302)
		expect(mocks.db.restockRequest.updateMany).toHaveBeenCalledTimes(1)
	})
})

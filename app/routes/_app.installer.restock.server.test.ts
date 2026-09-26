import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	requireInstaller: vi.fn(),
	createRestock: vi.fn(),
	db: {
		restockRequest: { update: vi.fn() },
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
		expect(mocks.db.restockRequest.update).not.toHaveBeenCalled()
	})

	it("an installer supervisor can approve", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		const req = formRequest({ intent: "approve", id: "r1" })
		await action({ request: req, params: {} } as never).catch(() => {})
		expect(mocks.db.restockRequest.update).toHaveBeenCalledWith({
			where: { id: "r1" },
			data: { status: "APPROVED", approvedById: "sup-1" },
		})
	})
})

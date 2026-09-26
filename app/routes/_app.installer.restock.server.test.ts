import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	requireInstaller: vi.fn(),
	createRestock: vi.fn(),
	buildRestockPrefill: vi.fn(),
	getActiveMaterialCodes: vi.fn(),
	db: {
		restockRequest: { updateMany: vi.fn(), findMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/restock.server", () => ({
	createRestock: mocks.createRestock,
	buildRestockPrefill: mocks.buildRestockPrefill,
}))
vi.mock("~/lib/service-codes.server", () => ({
	getActiveMaterialCodes: mocks.getActiveMaterialCodes,
}))
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { action, loader } from "./_app.installer.restock"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/installer/restock", {
		method: "POST",
		body: form,
	})
}

describe("GET /installer/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("gives the installer a pickable list of service codes to add lines from", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.buildRestockPrefill.mockResolvedValue([])
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-1",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "1.5",
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		expect(res.serviceCodes).toEqual([
			{ id: "sc-1", claroCode: "C1", name: "Wrap", unit: "EA", unitPrice: 1.5 },
		])
	})
})

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

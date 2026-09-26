import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	scanInReturn: vi.fn(),
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/scan-in.server", () => ({ scanInReturn: mocks.scanInReturn }))

import { action } from "./_app.warehouse.scan-in"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/warehouse/scan-in", {
		method: "POST",
		body: form,
	})
}

describe("POST /warehouse/scan-in", () => {
	beforeEach(() => vi.clearAllMocks())

	it("scans in an owed-back serial", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.scanInReturn.mockResolvedValue({ ok: true })
		const req = formRequest({ serial: "S1", warehouseId: "wh1" })
		const res = await action({ request: req, params: {} } as never)
		expect(mocks.scanInReturn).toHaveBeenCalledWith("S1", "wh1", { id: "wh-1" })
		expect(res).toEqual({ ok: true })
	})

	it("returns not-owed-back result unchanged", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.scanInReturn.mockResolvedValue({ ok: false, reason: "NOT_OWED_BACK" })
		const req = formRequest({ serial: "S2", warehouseId: "wh1" })
		const res = await action({ request: req, params: {} } as never)
		expect(res).toEqual({ ok: false, reason: "NOT_OWED_BACK" })
	})
})

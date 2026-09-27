import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	releaseRestockToVan: vi.fn(),
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/load-to-van.server", () => ({
	releaseRestockToVan: mocks.releaseRestockToVan,
}))

import { action } from "./_app.restock.$id_.release"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/restock/r1/release", {
		method: "POST",
		body: form,
	})
}

describe("POST /restock/:id/release", () => {
	beforeEach(() => vi.clearAllMocks())

	it("releases the restock to the van on dual signature", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		mocks.releaseRestockToVan.mockResolvedValue(undefined)
		const req = formRequest({
			serials: JSON.stringify([{ serial: "S1", serviceCodeId: "sc-1" }]),
			accessories: JSON.stringify([{ serviceCodeId: "sc-2", qty: 5 }]),
			releaseSignature: "data:image/png;base64,AAA",
			receiveSignature: "data:image/png;base64,BBB",
		})
		const res = await action({
			request: req,
			params: { id: "r1" },
		} as never)
		expect(mocks.releaseRestockToVan).toHaveBeenCalledWith(
			"r1",
			[{ serial: "S1", serviceCodeId: "sc-1" }],
			[{ serviceCodeId: "sc-2", qty: 5 }],
			{ id: "wh-1" },
		)
		expect((res as Response).status).toBe(302)
	})

	it("rejects when either signature is missing", async () => {
		mocks.requireRole.mockResolvedValue({ user: { id: "wh-1" } })
		const req = formRequest({
			serials: "[]",
			accessories: "[]",
			releaseSignature: "",
			receiveSignature: "",
		})
		const res = await action({
			request: req,
			params: { id: "r1" },
		} as never)
		expect(mocks.releaseRestockToVan).not.toHaveBeenCalled()
		expect(res).toEqual({
			errorKey: "restock_release.errors.signatures_required",
		})
	})
})

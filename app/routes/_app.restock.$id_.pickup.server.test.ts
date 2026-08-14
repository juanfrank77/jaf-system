import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		vanRestockRequest: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
		van: {
			findUnique: vi.fn(),
		},
		vanInventoryTransaction: {
			create: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (fn: any) => {
			if (typeof fn === "function") {
				return fn({
					vanRestockRequest: { update: vi.fn() },
					vanInventoryTransaction: { create: vi.fn() },
					notification: { create: vi.fn() },
				})
			}
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.restock.$id_.pickup"

function formRequest(form: FormData, id = "req-1") {
	return new Request(`http://localhost/restock/${id}/pickup`, {
		method: "POST",
		body: form,
	})
}

describe("POST /restock/:id/pickup", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseRequest() {
		return {
			id: "req-1",
			status: "READY",
			requestedById: "installer-1",
			items: [{ serviceCodeId: "sc-1", qty: 3, preparedQty: 3 }],
		}
	}

	it("requires a signature", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue(
			baseRequest() as any,
		)

		const form = new FormData()
		form.set("signature", "")

		const result = await action({
			request: formRequest(form),
			params: { id: "req-1" },
		} as any)

		expect(result).toEqual({
			errorKey: "restock_pickup.errors.signature_required",
		})
		expect(db.vanRestockRequest.update).not.toHaveBeenCalled()
	})

	it("fulfills request and adds inventory transactions on pickup", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "installer-1", role: "INSTALLER" },
			session: {},
		} as any)
		vi.mocked(db.vanRestockRequest.findUniqueOrThrow).mockResolvedValue({
			...baseRequest(),
			requestedBy: { id: "installer-1" },
		} as any)
		vi.mocked(db.van.findUnique).mockResolvedValue({
			id: "van-1",
		} as any)

		const updateFn = vi.fn()
		const txCreate = vi.fn()
		vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
			return fn({
				vanRestockRequest: { update: updateFn },
				vanInventoryTransaction: { create: txCreate },
				notification: { create: vi.fn() },
			})
		})

		const form = new FormData()
		form.set("signature", "data:image/png;base64,abc")

		const result = await action({
			request: formRequest(form),
			params: { id: "req-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(updateFn).toHaveBeenCalled()
		expect(updateFn.mock.calls[0][0].data.status).toBe("FULFILLED")
		expect(txCreate).toHaveBeenCalled()
		expect(txCreate.mock.calls[0][0].data.qty).toBe(3)
	})
})

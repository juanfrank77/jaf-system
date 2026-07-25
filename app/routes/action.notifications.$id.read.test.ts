import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		notification: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireSession: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { action } from "./action.notifications.$id.read"

function postRequest(id: string, redirectTo = "/dashboard") {
	const formData = new FormData()
	formData.set("redirectTo", redirectTo)
	return new Request(`http://localhost/notifications/${id}/read`, {
		method: "POST",
		body: formData,
	})
}

describe("POST /notifications/:id/read", () => {
	beforeEach(() => vi.clearAllMocks())

	it("marks the notification read and redirects to the doc when docId is set", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.findUniqueOrThrow).mockResolvedValue({
			id: "n1",
			userId: "user-1",
			docId: "doc-1",
			message: "test",
			read: false,
			createdAt: new Date(),
		} as any)
		vi.mocked(db.notification.update).mockResolvedValue({} as any)

		const result = await action({
			request: postRequest("n1"),
			params: { id: "n1" },
		} as any).catch((r) => r)

		expect(result).toBeInstanceOf(Response)
		expect(result.status).toBe(302)
		expect(result.headers.get("Location")).toBe("/docs/doc-1")
		expect(db.notification.update).toHaveBeenCalledWith({
			where: { id: "n1" },
			data: { read: true },
		})
	})

	it("redirects to redirectTo when docId is null", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.findUniqueOrThrow).mockResolvedValue({
			id: "n1",
			userId: "user-1",
			docId: null,
			message: "test",
			read: false,
			createdAt: new Date(),
		} as any)
		vi.mocked(db.notification.update).mockResolvedValue({} as any)

		const result = await action({
			request: postRequest("n1", "/dashboard"),
			params: { id: "n1" },
		} as any).catch((r) => r)

		expect(result.headers.get("Location")).toBe("/dashboard")
	})

	it("does not mark another user's notification as read", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.findUniqueOrThrow).mockResolvedValue({
			id: "n1",
			userId: "someone-else",
			docId: null,
			message: "test",
			read: false,
			createdAt: new Date(),
		} as any)

		const result = await action({
			request: postRequest("n1"),
			params: { id: "n1" },
		} as any).catch((r) => r)

		expect(result).toBeInstanceOf(Response)
		expect(result.status).toBe(403)
		expect(db.notification.update).not.toHaveBeenCalled()
	})
})

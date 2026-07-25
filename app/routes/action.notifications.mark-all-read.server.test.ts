import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		notification: {
			updateMany: vi.fn(),
		},
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireSession: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import { action } from "./action.notifications.mark-all-read"

function postRequest(redirectTo?: string) {
	const formData = new FormData()
	if (redirectTo !== undefined) formData.set("redirectTo", redirectTo)
	return new Request("http://localhost/notifications/mark-all-read", {
		method: "POST",
		body: formData,
	})
}

describe("POST /notifications/mark-all-read", () => {
	beforeEach(() => vi.clearAllMocks())

	it("marks all of the session user's unread notifications as read and redirects", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 2 } as any)

		const result = await action({
			request: postRequest("/dashboard"),
		} as any).catch((r) => r)

		expect(result).toBeInstanceOf(Response)
		expect(result.status).toBe(302)
		expect(result.headers.get("Location")).toBe("/dashboard")
		expect(db.notification.updateMany).toHaveBeenCalledWith({
			where: { userId: "user-1", read: false },
			data: { read: true },
		})
	})

	it("defaults redirectTo to /dashboard when not provided", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 0 } as any)

		const result = await action({ request: postRequest() } as any).catch(
			(r) => r,
		)

		expect(result.headers.get("Location")).toBe("/dashboard")
	})

	it("falls back to /dashboard for a non-relative redirectTo", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 0 } as any)

		const result = await action({
			request: postRequest("https://evil.com"),
		} as any).catch((r) => r)

		expect(result.headers.get("Location")).toBe("/dashboard")
	})

	it("falls back to /dashboard for a protocol-relative redirectTo", async () => {
		vi.mocked(requireSession).mockResolvedValue({
			user: { id: "user-1" },
		} as any)
		vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 0 } as any)

		const result = await action({
			request: postRequest("//evil.com"),
		} as any).catch((r) => r)

		expect(result.headers.get("Location")).toBe("/dashboard")
	})
})

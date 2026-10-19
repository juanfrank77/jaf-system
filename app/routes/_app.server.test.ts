import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		user: { findUniqueOrThrow: vi.fn() },
		notification: { findMany: vi.fn() },
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))
vi.mock("~/lib/nav-counts.server", () => ({
	loadNavCounts: vi.fn().mockResolvedValue({}),
}))

import { db } from "~/lib/db.server"
import { loadNavCounts } from "~/lib/nav-counts.server"
import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app"

const args = () => ({ request: new Request("http://x/docs/doc-1") }) as any

function as(role: string) {
	vi.mocked(requireSession).mockResolvedValue({ user: { id: "u1" } } as any)
	vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
		id: "u1",
		name: "U",
		role,
	} as any)
	vi.mocked(db.notification.findMany).mockResolvedValue([])
}

describe("app layout loader (every signed-in page)", () => {
	beforeEach(() => vi.clearAllMocks())

	it("sends a CREW session to the crew notice instead of any app screen", async () => {
		as("CREW")
		const res = await loader(args()).catch((r: unknown) => r)
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).status).toBe(302)
		expect((res as Response).headers.get("Location")).toBe("/crew-notice")
		// Nothing about the app is loaded for it.
		expect(db.notification.findMany).not.toHaveBeenCalled()
		expect(loadNavCounts).not.toHaveBeenCalled()
	})

	it("still renders the shell for the other roles", async () => {
		as("SUPERVISOR")
		const data = await loader(args())
		expect(data.user.role).toBe("SUPERVISOR")
	})
})

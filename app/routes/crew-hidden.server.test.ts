import { redirect } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Crew accounts no longer sign in: the supervisor enters the brigade's field
// work. Every job screen a crew member used to open must refuse a CREW
// session before it reads anything.
vi.mock("~/lib/db.server", () => ({
	db: new Proxy(
		{},
		{
			get(_t, prop) {
				throw new Error(`db.${String(prop)} read for a CREW session`)
			},
		},
	),
}))
vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
	requireSession: vi.fn(),
}))

import { requireRole } from "~/lib/permissions.server"
import * as field from "./_app.docs.$id_.field"
import * as returns from "./_app.docs.$id_.returns"
import * as review from "./_app.docs.$id_.review"
import * as sign from "./_app.docs.$id_.sign"
import * as newDoc from "./_app.docs.new"

const screens = [
	["docs/new", newDoc],
	["docs/:id/sign", sign],
	["docs/:id/field", field],
	["docs/:id/review", review],
	["docs/:id/returns", returns],
] as const

describe("crew job screens refuse a CREW session", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// The real requireRole: a role off the allow-list goes to /dashboard
		// (which in turn sends CREW to the crew notice).
		vi.mocked(requireRole).mockImplementation(async (_req, roles) => {
			if (!(roles as string[]).includes("CREW")) throw redirect("/dashboard")
			return { user: { id: "crew-1", role: "CREW" }, session: {} } as any
		})
	})

	for (const [name, mod] of screens) {
		it(`${name}: loader and action redirect, nothing is read`, async () => {
			const args = {
				request: new Request("http://localhost/x", {
					method: "POST",
					body: new FormData(),
				}),
				params: { id: "doc-1" },
			} as any
			for (const fn of [mod.loader, mod.action]) {
				const res = await (fn as (a: unknown) => Promise<unknown>)(args).catch(
					(e: unknown) => e,
				)
				expect(res).toBeInstanceOf(Response)
				expect((res as Response).headers.get("Location")).toBe("/dashboard")
			}
		})
	}
})

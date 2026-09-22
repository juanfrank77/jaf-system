import { describe, expect, it } from "vitest"
import { requireJobAccess } from "./job-access.server"

describe("requireJobAccess", () => {
	const doc = { supervisorId: "sup-a" }

	it("allows ADMIN on any job", () => {
		expect(() =>
			requireJobAccess({ id: "other", role: "ADMIN" }, doc, "write"),
		).not.toThrow()
	})

	it("allows the owning supervisor", () => {
		expect(() =>
			requireJobAccess({ id: "sup-a", role: "SUPERVISOR" }, doc, "read"),
		).not.toThrow()
	})

	it("returns 404 for another supervisor", () => {
		try {
			requireJobAccess({ id: "sup-b", role: "SUPERVISOR" }, doc, "write")
			expect.fail("expected 404")
		} catch (e) {
			expect(e).toBeInstanceOf(Response)
			expect((e as Response).status).toBe(404)
		}
	})

	it("does not block other roles", () => {
		expect(() =>
			requireJobAccess({ id: "crew-1", role: "CREW" }, doc, "read"),
		).not.toThrow()
	})
})

import { describe, expect, it } from "vitest"
import {
	assertDocInSupervisorScope,
	isBrigadeInSupervisorScope,
	supervisorAreas,
} from "./supervisor-scope"

function fakeDb(supervisorAreas: string[] | null) {
	return {
		user: {
			findUnique: async () =>
				supervisorAreas === null ? null : { supervisorAreas },
		},
	} as any
}

describe("supervisorAreas", () => {
	it("returns the admin-assigned areas for a multi-area supervisor", async () => {
		const db = fakeDb(["OESTE", "SUR"])
		expect(await supervisorAreas(db, "u-ramon")).toEqual(["OESTE", "SUR"])
	})
	it("returns [] when the supervisor has no assigned areas", async () => {
		const db = fakeDb([])
		expect(await supervisorAreas(db, "u-none")).toEqual([])
	})
	it("returns [] when the user can't be found", async () => {
		const db = fakeDb(null)
		expect(await supervisorAreas(db, "u-missing")).toEqual([])
	})
	it("never derives areas from Brigade — a brigade edit cannot change this", async () => {
		// Regression guard: earlier implementations derived this from
		// db.brigade.findMany(); a db stub with no `brigade` property at all
		// must still work, proving the function never touches Brigade.
		const db = {
			user: { findUnique: async () => ({ supervisorAreas: ["SUR"] }) },
		} as any
		expect(await supervisorAreas(db, "u-1")).toEqual(["SUR"])
	})
})

describe("assertDocInSupervisorScope", () => {
	it("denies a doc whose brigade has a null area", async () => {
		const db = fakeDb([])
		await expect(
			assertDocInSupervisorScope(db, "u-1", {
				supervisorId: "someone-else",
				brigade: { area: null },
			}),
		).rejects.toMatchObject({ status: 302 })
	})
	it("allows a doc in one of the supervisor's admin-assigned areas", async () => {
		const db = fakeDb(["SUR"])
		await expect(
			assertDocInSupervisorScope(db, "u-1", {
				supervisorId: "someone-else",
				brigade: { area: "SUR" },
			}),
		).resolves.toBeUndefined()
	})
	it("always allows a doc the supervisor owns directly, regardless of area", async () => {
		const db = fakeDb([])
		await expect(
			assertDocInSupervisorScope(db, "u-1", {
				supervisorId: "u-1",
				brigade: { area: "METRO" },
			}),
		).resolves.toBeUndefined()
	})
})

describe("isBrigadeInSupervisorScope", () => {
	it("allows a brigade in one of the supervisor's admin-assigned areas", async () => {
		const db = fakeDb(["SUR"])
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: "SUR" })).toBe(
			true,
		)
	})
	it("denies a brigade in a foreign area", async () => {
		const db = fakeDb(["SUR"])
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: "METRO" })).toBe(
			false,
		)
	})
	it("denies a null brigade", async () => {
		const db = fakeDb(["SUR"])
		expect(await isBrigadeInSupervisorScope(db, "u-1", null)).toBe(false)
	})
	it("denies a null-area brigade even when the supervisor has assigned areas", async () => {
		const db = fakeDb(["SUR"])
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: null })).toBe(
			false,
		)
	})
})

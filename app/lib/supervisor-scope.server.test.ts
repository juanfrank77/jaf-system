import { describe, expect, it } from "vitest"
import {
	assertDocInSupervisorScope,
	assignableBrigadesWhere,
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
	it("trims a stray untrimmed stored value rather than treating it as a distinct area", async () => {
		const db = fakeDb(["CENTRAL "])
		expect(await supervisorAreas(db, "u-1")).toEqual(["CENTRAL"])
	})
	it("drops a stored value outside the canonical area set instead of granting scope over it", async () => {
		const db = fakeDb(["CENTRAL", "NOT-A-REAL-AREA"])
		expect(await supervisorAreas(db, "u-1")).toEqual(["CENTRAL"])
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

describe("assignableBrigadesWhere", () => {
	it("scopes and bounds the picker for a SUPERVISOR", async () => {
		const db = fakeDb(["CENTRAL", "METRO"])
		expect(
			await assignableBrigadesWhere(db, { id: "u-1", role: "SUPERVISOR" }),
		).toEqual({
			where: { active: true, area: { in: ["CENTRAL", "METRO"] } },
			take: 100,
		})
	})
	it("leaves the picker unscoped and unbounded for a non-SUPERVISOR (e.g. ADMIN)", async () => {
		const db = fakeDb([])
		expect(
			await assignableBrigadesWhere(db, { id: "u-1", role: "ADMIN" }),
		).toEqual({ where: { active: true }, take: undefined })
	})
	it("a SUPERVISOR with zero admin-assigned areas gets an empty (not unscoped) picker", async () => {
		const db = fakeDb([])
		expect(
			await assignableBrigadesWhere(db, { id: "u-1", role: "SUPERVISOR" }),
		).toEqual({ where: { active: true, area: { in: [] } }, take: 100 })
	})
})

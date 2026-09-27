import { describe, expect, it } from "vitest"
import {
	assertDocInSupervisorScope,
	isBrigadeInSupervisorScope,
	supervisorAreas,
} from "./supervisor-scope"

describe("supervisorAreas", () => {
	it("returns every area the supervisor owns (union for multi-area)", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: "OESTE" }, { area: "SUR" }] },
		} as any
		expect(await supervisorAreas(db, "u-ramon")).toEqual(["OESTE", "SUR"])
	})
	it("returns [] when the supervisor owns no brigades", async () => {
		const db = { brigade: { findMany: async () => [] } } as any
		expect(await supervisorAreas(db, "u-none")).toEqual([])
	})
	it("filters out a null area rather than returning it", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: null }, { area: "SUR" }] },
		} as any
		expect(await supervisorAreas(db, "u-mixed")).toEqual(["SUR"])
	})
})

describe("assertDocInSupervisorScope", () => {
	it("denies a doc whose brigade has a null area, even if the supervisor owns another null-area brigade", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: null }] },
		} as any
		await expect(
			assertDocInSupervisorScope(db, "u-1", {
				supervisorId: "someone-else",
				brigade: { area: null },
			}),
		).rejects.toMatchObject({ status: 302 })
	})
})

describe("isBrigadeInSupervisorScope", () => {
	it("allows a brigade in one of the supervisor's own areas", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: "SUR" }] },
		} as any
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: "SUR" })).toBe(
			true,
		)
	})
	it("denies a brigade in a foreign area", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: "SUR" }] },
		} as any
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: "METRO" })).toBe(
			false,
		)
	})
	it("denies a null brigade", async () => {
		const db = { brigade: { findMany: async () => [{ area: "SUR" }] } } as any
		expect(await isBrigadeInSupervisorScope(db, "u-1", null)).toBe(false)
	})
	it("denies a null-area brigade even when the supervisor owns another null-area brigade", async () => {
		const db = {
			brigade: { findMany: async () => [{ area: null }] },
		} as any
		expect(await isBrigadeInSupervisorScope(db, "u-1", { area: null })).toBe(
			false,
		)
	})
})

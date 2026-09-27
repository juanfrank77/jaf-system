import { describe, expect, it } from "vitest"
import { supervisorAreas } from "./supervisor-scope"

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
})

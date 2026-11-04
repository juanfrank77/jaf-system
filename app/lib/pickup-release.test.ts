import { describe, expect, it } from "vitest"
import { addTaken, releaseOverages, remainingToTake } from "./pickup-release"

const l = (serviceCodeId: string, qty: number) => ({ serviceCodeId, qty })

describe("addTaken", () => {
	it("adds a release to the running total", () => {
		expect(addTaken([l("a", 2), l("b", 1)], [l("a", 3), l("c", 4)])).toEqual([
			l("a", 5),
			l("b", 1),
			l("c", 4),
		])
	})
})

describe("remainingToTake", () => {
	it("shows what is left and drops what is fully taken", () => {
		expect(
			remainingToTake(
				[l("a", 6), l("b", 2), l("c", 1)],
				[l("a", 2), l("b", 3)],
			),
		).toEqual([l("a", 4), l("c", 1)])
	})
})

describe("releaseOverages", () => {
	it("flags a line only when the running total passes the request", () => {
		expect(releaseOverages([l("a", 3)], [l("a", 7)], [l("a", 6)])).toEqual([
			{ serviceCodeId: "a", estimatedQty: 6, takenQty: 7 },
		])
		expect(releaseOverages([l("a", 3)], [l("a", 5)], [l("a", 6)])).toEqual([])
	})
	it("does not flag an earlier overage again on a release without that line", () => {
		expect(
			releaseOverages(
				[l("b", 1)],
				[l("a", 9), l("b", 1)],
				[l("a", 6), l("b", 2)],
			),
		).toEqual([])
	})
})

import { describe, expect, it } from "vitest"
import {
	assignedBrigadeIds,
	buildCrewAssignment,
	parseBrigadeIds,
	readHistory,
} from "./crew-assignment"

describe("parseBrigadeIds", () => {
	it("keeps selection order, trims, drops blanks and duplicates", () => {
		const form = new FormData()
		for (const v of [" b2 ", "", "b1", "b2"]) form.append("brigadeId", v)
		expect(parseBrigadeIds(form)).toEqual(["b2", "b1"])
	})
	it("returns an empty list when nothing was selected", () => {
		expect(parseBrigadeIds(new FormData())).toEqual([])
	})
})

describe("buildCrewAssignment", () => {
	const b1 = { id: "b1", memberIds: ["u1", "u2"] }
	const b2 = { id: "b2", memberIds: ["u2", "u3"] }
	it("makes the first brigade the lead and unions every member once", () => {
		expect(buildCrewAssignment([b2, b1])).toEqual({
			brigadeId: "b2",
			brigadeIds: ["b2", "b1"],
			assignedCrewIds: ["u2", "u3", "u1"],
		})
	})
	it("behaves like the single-brigade case for one brigade", () => {
		expect(buildCrewAssignment([b1])).toEqual({
			brigadeId: "b1",
			brigadeIds: ["b1"],
			assignedCrewIds: ["u1", "u2"],
		})
	})
})

describe("assignedBrigadeIds", () => {
	it("reads brigadeIds from the latest history entry", () => {
		expect(
			assignedBrigadeIds({
				brigadeId: "b1",
				crewAssignmentHistory: [
					{ brigadeId: "old", by: "x", at: "t" },
					{ brigadeIds: ["b1", "b2"], brigadeId: "b1" },
				],
			}),
		).toEqual(["b1", "b2"])
	})
	it("falls back to the lead brigade when the latest entry has no list", () => {
		expect(
			assignedBrigadeIds({
				brigadeId: "b3",
				crewAssignmentHistory: [
					{ brigadeIds: ["b1", "b2"] },
					{ brigadeId: "b3" },
				],
			}),
		).toEqual(["b3"])
	})
	it("tolerates a missing or non-array history and a null brigade", () => {
		expect(
			assignedBrigadeIds({ brigadeId: "b1", crewAssignmentHistory: null }),
		).toEqual(["b1"])
		expect(
			assignedBrigadeIds({ brigadeId: "b1", crewAssignmentHistory: "[]" }),
		).toEqual(["b1"])
		expect(
			assignedBrigadeIds({ brigadeId: null, crewAssignmentHistory: [] }),
		).toEqual([])
	})
})

describe("readHistory", () => {
	it("returns an array as-is, parses the legacy stringified form, else []", () => {
		expect(readHistory([{ a: 1 }])).toEqual([{ a: 1 }])
		expect(readHistory('[{"brigadeId":"b1"}]')).toEqual([{ brigadeId: "b1" }])
		expect(readHistory("not json")).toEqual([])
		expect(readHistory(null)).toEqual([])
		expect(readHistory({})).toEqual([])
	})
	it("lets assignedBrigadeIds read a legacy stringified history", () => {
		expect(
			assignedBrigadeIds({
				brigadeId: "b1",
				crewAssignmentHistory: '[{"brigadeIds":["b1","b2"]}]',
			}),
		).toEqual(["b1", "b2"])
	})
})

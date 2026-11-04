import { describe, expect, it } from "vitest"
import {
	crewLinesOf,
	crewsOnJob,
	everyCrewHasLines,
	hasSplitLine,
	lineOwners,
	normalizeInstalled,
	readCrewLines,
	sumCrewLines,
	unassignedLines,
	withCrewLines,
} from "./crew-field"

const line = (id: string, qty: number, extra = {}) => ({
	serviceCodeId: id,
	claroCode: id,
	accountCode: null,
	name: id,
	qty,
	...extra,
})

const svc = (serviceCodeId: string, qty = 1) => ({
	serviceCodeId,
	claroCode: serviceCodeId,
	accountCode: null,
	name: serviceCodeId,
	qty,
})

describe("a service line belongs to one brigade", () => {
	const crews = [
		{ brigadeId: "b1", lines: [svc("a"), svc("b")] },
		{ brigadeId: "b2", lines: [svc("c")] },
	]
	it("names the brigade holding each line", () => {
		expect([...lineOwners(crews)]).toEqual([
			["a", "b1"],
			["b", "b1"],
			["c", "b2"],
		])
	})
	it("spots a line two brigades hold", () => {
		expect(hasSplitLine(crews)).toBe(false)
		expect(
			hasSplitLine([...crews, { brigadeId: "b3", lines: [svc("a")] }]),
		).toBe(true)
	})
	it("lists the ordered lines nobody ticked", () => {
		expect(
			unassignedLines([svc("a"), svc("c"), svc("d")], crews).map(
				(l) => l.serviceCodeId,
			),
		).toEqual(["d"])
	})
})

describe("sumCrewLines", () => {
	it("adds a service both crews did, keeping first-seen order", () => {
		const total = sumCrewLines([
			{ brigadeId: "a", lines: [line("fiber", 600), line("digger", 1)] },
			{ brigadeId: "b", lines: [line("fiber", 400)] },
		])
		expect(total.map((l) => [l.serviceCodeId, l.qty])).toEqual([
			["fiber", 1000],
			["digger", 1],
		])
	})

	it("flags a total line added in the field when either crew added it", () => {
		const total = sumCrewLines([
			{ brigadeId: "a", lines: [line("x", 1)] },
			{ brigadeId: "b", lines: [line("x", 2, { addedInField: true })] },
		])
		expect(total).toEqual([
			expect.objectContaining({ qty: 3, addedInField: true }),
		])
	})

	it("is empty without crews", () => {
		expect(sumCrewLines([])).toEqual([])
	})
})

describe("readCrewLines", () => {
	it("reads valid entries and drops malformed ones", () => {
		expect(
			readCrewLines([
				{ brigadeId: "a", lines: [line("x", 2)] },
				{ lines: [] },
				null,
				{ brigadeId: "c", lines: "nope" },
			]),
		).toEqual([{ brigadeId: "a", lines: [line("x", 2)] }])
	})

	it("treats a non-list as none", () => {
		expect(readCrewLines(null)).toEqual([])
		expect(readCrewLines("x")).toEqual([])
	})
})

describe("withCrewLines / crewLinesOf", () => {
	it("replaces a crew's lines or adds the crew", () => {
		const one = withCrewLines([], "a", [line("x", 1)])
		const two = withCrewLines(one, "b", [line("y", 2)])
		const redo = withCrewLines(two, "a", [line("x", 5)])
		expect(crewLinesOf(redo, "a")[0].qty).toBe(5)
		expect(crewLinesOf(redo, "b")[0].qty).toBe(2)
		expect(crewLinesOf(redo, "none")).toEqual([])
	})
})

describe("crewsOnJob", () => {
	const posted = [
		{ brigadeId: "b", lines: [] },
		{ brigadeId: "a", lines: [] },
	]
	it("orders the posted crews like the job", () => {
		expect(crewsOnJob(posted, ["a", "b"])?.map((c) => c.brigadeId)).toEqual([
			"a",
			"b",
		])
	})
	it("refuses a brigade that is not on the job, or a repeat", () => {
		expect(crewsOnJob(posted, ["a"])).toBeNull()
		expect(crewsOnJob([posted[0], posted[0]], ["a", "b"])).toBeNull()
	})
})

describe("everyCrewHasLines", () => {
	it("needs a line from every crew on the job", () => {
		const crews = [{ brigadeId: "a", lines: [line("x", 1)] }]
		expect(everyCrewHasLines(crews, ["a"])).toBe(true)
		expect(everyCrewHasLines(crews, ["a", "b"])).toBe(false)
	})
})

describe("normalizeInstalled", () => {
	it("keeps a zero quantity and rejects a non-list", () => {
		expect(normalizeInstalled([{ serviceCodeId: "x", qty: 0 }])).toHaveLength(1)
		expect(() => normalizeInstalled("x")).toThrow()
	})
})

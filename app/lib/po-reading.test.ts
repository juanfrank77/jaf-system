import { describe, expect, it } from "vitest"
import {
	coercePoRead,
	isOverridable,
	type PoRead,
	parseClaroDate,
	recomputeFromLines,
	runPoChecks,
	statusFromChecks,
} from "./po-reading"

const good = (): PoRead => ({
	poNumber: "4500526054",
	poDate: "2026-09-04",
	statedPages: 4,
	termsDays: 60,
	avisoCandidates: ["10343504"],
	lines: [
		{
			item: "00010",
			description: "A",
			amount: 224.25,
			ivuRate: 0.04,
			ivu: 8.97,
		},
		{
			item: "00020",
			description: "B",
			amount: 592.78,
			ivuRate: 0.115,
			ivu: 68.17,
		},
	],
	subtotal: 817.03,
	ivu4: 8.97,
	ivu115: 68.17,
	total: 894.17,
})
const ctx = {
	filePages: 4,
	duplicate: false,
	billedPreIvu: 900,
	alreadyPod: 0,
}
const codes = (r: PoRead, c = ctx) => runPoChecks(r, c).map((x) => x.code)

describe("parseClaroDate", () => {
	it("reads DD.MM.YYYY day-first", () => {
		expect(parseClaroDate("04.09.2026")).toBe("2026-09-04")
		expect(parseClaroDate("14.05.2026")).toBe("2026-05-14")
	})
	it("rejects impossible or malformed dates", () => {
		expect(parseClaroDate("31.02.2026")).toBeNull()
		expect(parseClaroDate("2026-09-04")).toBeNull()
		expect(parseClaroDate(null)).toBeNull()
	})
})

describe("runPoChecks", () => {
	it("passes a clean PO", () => {
		expect(codes(good())).toEqual([])
		expect(statusFromChecks([], true)).toBe("READY")
	})
	it("asks for a look when the lines do not add to the subtotal", () => {
		const r = good()
		r.subtotal = 800
		expect(codes(r)).toContain("lines_sum")
		expect(statusFromChecks(runPoChecks(r, ctx), true)).toBe("NEEDS_LOOK")
	})
	it("asks for a look when subtotal + IVU is not the total", () => {
		const r = good()
		r.total = 900
		const checks = runPoChecks(r, ctx)
		expect(checks.map((c) => c.code)).toContain("totals")
		expect(statusFromChecks(checks, true)).toBe("NEEDS_LOOK")
	})
	it("still blocks missing pages", () => {
		const checks = runPoChecks(good(), { ...ctx, filePages: 3 })
		expect(statusFromChecks(checks, true)).toBe("BLOCKED")
	})
	it("only pages_missing and duplicate are not overridable", () => {
		const codesAll = [
			"lines_sum",
			"totals",
			"ivu_line",
			"po_number_format",
			"pages_unknown",
			"po_date_missing",
			"terms_missing",
			"over_billed",
			"unreadable",
		] as const
		for (const code of codesAll)
			expect(isOverridable({ code, severity: "needs_look" })).toBe(true)
		for (const code of ["pages_missing", "duplicate"] as const)
			expect(isOverridable({ code, severity: "blocked" })).toBe(false)
	})
	it("recomputes totals from the lines", () => {
		expect(recomputeFromLines([])).toEqual({
			subtotal: 0,
			ivu4: 0,
			ivu115: 0,
			total: 0,
		})
		expect(recomputeFromLines(good().lines)).toEqual({
			subtotal: 817.03,
			ivu4: 8.97,
			ivu115: 68.17,
			total: 894.17,
		})
	})
	it("flags an IVU more than a cent off as Needs a look", () => {
		const r = good()
		r.lines[1].ivu = 68.2
		r.ivu115 = 68.2
		r.total = 894.2
		const checks = runPoChecks(r, ctx)
		expect(checks.map((c) => c.code)).toEqual(["ivu_line"])
		expect(statusFromChecks(checks, true)).toBe("NEEDS_LOOK")
	})
	it("flags a PO number that is not 10 digits", () => {
		const r = good()
		r.poNumber = "45005260"
		expect(codes(r)).toContain("po_number_format")
	})
	it("blocks a duplicate", () => {
		expect(codes(good(), { ...ctx, duplicate: true })).toContain("duplicate")
	})
	it("blocks when the file has fewer pages than the PO says", () => {
		expect(codes(good(), { ...ctx, filePages: 3 })).toContain("pages_missing")
	})
	it("flags POs adding to more than JAF billed", () => {
		expect(codes(good(), { ...ctx, billedPreIvu: 800 })).toContain(
			"over_billed",
		)
		expect(
			codes(good(), { ...ctx, billedPreIvu: 900, alreadyPod: 100 }),
		).toContain("over_billed")
	})
	it("is Unmatched when no Aviso was found, unless blocked", () => {
		expect(statusFromChecks([], false)).toBe("UNMATCHED")
		expect(
			statusFromChecks([{ code: "duplicate", severity: "blocked" }], false),
		).toBe("BLOCKED")
	})
})

describe("coercePoRead", () => {
	it("normalises rates, digits and dates and survives junk", () => {
		const r = coercePoRead({
			poNumber: "4500 526054",
			poDate: "04.09.2026",
			avisoCandidates: ["10343504", "123", "10343504"],
			lines: [{ amount: "10.00", ivuRate: 11.5, ivu: 1.15 }, { nope: 1 }],
			subtotal: "10",
		})
		expect(r.poNumber).toBe("4500526054")
		expect(r.poDate).toBe("2026-09-04")
		expect(r.avisoCandidates).toEqual(["10343504"])
		expect(r.lines).toHaveLength(1)
		expect(r.lines[0].ivuRate).toBe(0.115)
		expect(r.subtotal).toBe(10)
		expect(coercePoRead(null).lines).toEqual([])
	})
})

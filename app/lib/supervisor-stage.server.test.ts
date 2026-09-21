import { describe, expect, it } from "vitest"
import {
	checkAvisoMatch,
	deriveSupervisorStage,
	evaluateReleaseGate,
	supervisorStageToGuideStep,
} from "./supervisor-stage"

const now = new Date()
const base = {
	status: "FIELD_UPDATED" as const,
	supervisorApprovedAt: null,
	jafInvoiceGeneratedAt: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
}

describe("deriveSupervisorStage", () => {
	it("follows status before approval", () => {
		expect(deriveSupervisorStage({ ...base, status: "CREATED" }, null)).toBe(
			"INTAKE",
		)
		expect(deriveSupervisorStage({ ...base, status: "PREPPED" }, null)).toBe(
			"WAREHOUSE",
		)
		expect(deriveSupervisorStage({ ...base, status: "SIGNED" }, null)).toBe(
			"FIELD",
		)
		expect(
			deriveSupervisorStage({ ...base, status: "FIELD_UPDATED" }, null),
		).toBe("APPROVE")
	})
	it("follows timestamps after approval", () => {
		const approved = {
			...base,
			status: "SUPERVISOR_APPROVED" as const,
			supervisorApprovedAt: now,
		}
		expect(deriveSupervisorStage(approved, null)).toBe("INVOICE")
		expect(
			deriveSupervisorStage({ ...approved, jafInvoiceGeneratedAt: now }, null),
		).toBe("AVISO")
		const matched = {
			...approved,
			jafInvoiceGeneratedAt: now,
			avisoMatchedAt: now,
		}
		expect(deriveSupervisorStage(matched, null)).toBe("PRECERT")
		expect(
			deriveSupervisorStage(matched, {
				sigSupervisorAt: now,
				sigSubcontractorAt: null,
			}),
		).toBe("PRECERT")
		expect(
			deriveSupervisorStage(matched, {
				sigSupervisorAt: now,
				sigSubcontractorAt: now,
			}),
		).toBe("RELEASE")
		expect(
			deriveSupervisorStage(
				{ ...matched, releasedToFinanceAt: now },
				{ sigSupervisorAt: now, sigSubcontractorAt: now },
			),
		).toBe("RELEASED")
	})
})

const inv = (id: string, code: string, qty: number, unitPrice: number) => ({
	serviceCodeId: id,
	claroCode: code,
	accountCode: null,
	name: code,
	unit: "EA",
	qty,
	unitPrice,
	lineAmount: Math.round(qty * unitPrice * 100) / 100,
})
const av = (id: string, code: string, qty: number, unitPrice: number) => ({
	serviceCodeId: id,
	claroCode: code,
	qty,
	unitPrice,
	lineAmount: Math.round(qty * unitPrice * 100) / 100,
})

describe("checkAvisoMatch", () => {
	it("passes when totals agree within tolerance", () => {
		const r = checkAvisoMatch(
			[inv("a", "1", 5, 42.343)],
			[av("a", "1", 5, 42.343)],
			0.01,
		)
		expect(r.amountOk).toBe(true)
		expect(r.lineMismatches).toEqual([])
		expect(r.invoiceTotal).toBe(211.72)
		expect(r.avisoTotal).toBe(211.72)
	})
	it("fails on a one-cent-over difference", () => {
		const r = checkAvisoMatch(
			[inv("a", "1", 1, 10)],
			[av("a", "1", 1, 10.02)],
			0.01,
		)
		expect(r.amountOk).toBe(false)
		expect(r.difference).toBe(0.02)
	})
	it("passes at exactly the tolerance", () => {
		expect(
			checkAvisoMatch([inv("a", "1", 1, 10)], [av("a", "1", 1, 10.01)], 0.01)
				.amountOk,
		).toBe(true)
	})
	it("reports per-line quantity mismatches including missing lines", () => {
		const r = checkAvisoMatch(
			[inv("a", "1", 2, 10), inv("b", "2", 1, 5)],
			[av("a", "1", 1, 10), av("c", "3", 1, 15)],
			0.01,
		)
		expect(r.lineMismatches).toEqual([
			{ serviceCodeId: "a", claroCode: "1", installedQty: 2, chargedQty: 1 },
			{ serviceCodeId: "b", claroCode: "2", installedQty: 1, chargedQty: 0 },
			{ serviceCodeId: "c", claroCode: "3", installedQty: 0, chargedQty: 1 },
		])
	})
})

describe("evaluateReleaseGate", () => {
	const good = {
		supervisorApprovedAt: now,
		jafInvoiceGeneratedAt: now,
		avisoNumber: "10353961",
		avisoDocPath: "/x/aviso.pdf",
		avisoLines: [
			{
				serviceCodeId: "a",
				claroCode: "1",
				qty: 1,
				unitPrice: 1,
				lineAmount: 1,
			},
		],
		avisoMatchedAt: now,
		contractorAccountCode: "204",
	}
	const sheet = { sigSupervisorAt: now, sigSubcontractorAt: now }
	const photos = [{ tag: "BEFORE" as const }, { tag: "AFTER" as const }]

	it("passes when all seven hold", () => {
		const r = evaluateReleaseGate(good, sheet, photos)
		expect(r.ok).toBe(true)
		expect(r.conditions.map((c) => c.key)).toEqual([
			"approved",
			"invoice",
			"aviso",
			"amount_match",
			"photos",
			"precert_signed",
			"contractor_code",
		])
	})
	it.each([
		["approved", { supervisorApprovedAt: null }],
		["invoice", { jafInvoiceGeneratedAt: null }],
		["aviso", { avisoDocPath: null }],
		["aviso", { avisoLines: [] }],
		["amount_match", { avisoMatchedAt: null }],
		["contractor_code", { contractorAccountCode: null }],
	])("fails %s", (key, patch) => {
		const r = evaluateReleaseGate({ ...good, ...patch }, sheet, photos)
		expect(r.ok).toBe(false)
		expect(r.conditions.find((c) => c.key === key)?.ok).toBe(false)
	})
	it("fails photos when an AFTER photo is missing", () => {
		const r = evaluateReleaseGate(good, sheet, [{ tag: "BEFORE" }])
		expect(r.conditions.find((c) => c.key === "photos")?.ok).toBe(false)
	})
	it("fails precert_signed without the sub-contractor signature", () => {
		const r = evaluateReleaseGate(
			good,
			{ sigSupervisorAt: now, sigSubcontractorAt: null },
			photos,
		)
		expect(r.conditions.find((c) => c.key === "precert_signed")?.ok).toBe(false)
		expect(evaluateReleaseGate(good, null, photos).ok).toBe(false)
	})
})

describe("supervisorStageToGuideStep", () => {
	it("maps nine stages onto the guide's 1–8 strip", () => {
		expect(supervisorStageToGuideStep("INTAKE")).toBe(1)
		expect(supervisorStageToGuideStep("WAREHOUSE")).toBe(2)
		expect(supervisorStageToGuideStep("FIELD")).toBe(4)
		expect(supervisorStageToGuideStep("APPROVE")).toBe(5)
		expect(supervisorStageToGuideStep("INVOICE")).toBe(6)
		expect(supervisorStageToGuideStep("AVISO")).toBe(7)
		expect(supervisorStageToGuideStep("PRECERT")).toBe(7)
		expect(supervisorStageToGuideStep("RELEASE")).toBe(8)
		expect(supervisorStageToGuideStep("RELEASED")).toBe(8)
	})
})

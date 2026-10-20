import { describe, expect, it } from "vitest"
import {
	checkAvisoMatch,
	deriveSupervisorStage,
	evaluateReleaseGate,
	isAvisoStarted,
	panelForStep,
	resolveStepView,
	WAITING_ON,
} from "./supervisor-stage"

const now = new Date()
const base = {
	status: "FIELD_UPDATED" as const,
	supervisorApprovedAt: null,
	jafInvoiceGeneratedAt: null,
	avisoNumber: null,
	avisoDocPath: null,
	releasedToFinanceAt: null,
}

describe("WAITING_ON", () => {
	it("a job in Field waits on the supervisor, who fills it in for the brigade", () => {
		expect(WAITING_ON.FIELD).toBe("you")
		expect(WAITING_ON.INTAKE).toBe("warehouse")
		expect(WAITING_ON.RELEASED).toBe("finance")
	})
})

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
	it("a legacy avisoMatchedAt without a saved Aviso PDF stays at AVISO, not PRECERT", () => {
		const legacy = {
			...base,
			status: "SUPERVISOR_APPROVED" as const,
			supervisorApprovedAt: now,
			jafInvoiceGeneratedAt: now,
			avisoNumber: "10353961",
			avisoDocPath: null,
			avisoMatchedAt: now,
		}
		expect(deriveSupervisorStage(legacy, null)).toBe("AVISO")
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
			avisoNumber: "10353961",
			avisoDocPath: "/x/aviso-docs/a.pdf",
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
		["amount_match", { avisoNumber: null }],
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

describe("isAvisoStarted", () => {
	it("ignores an Aviso number typed at intake", () => {
		expect(isAvisoStarted({ avisoNumber: "10354494", avisoLines: null })).toBe(
			false,
		)
	})
	it("is started once the supervisor has saved Aviso lines", () => {
		expect(isAvisoStarted({ avisoNumber: "10354494", avisoLines: [] })).toBe(
			true,
		)
	})
	it("is not started with nothing saved", () => {
		expect(isAvisoStarted({ avisoNumber: null, avisoLines: null })).toBe(false)
	})
})

describe("resolveStepView", () => {
	it("defaults to the derived stage and is interactive there", () => {
		expect(resolveStepView("PRECERT", true, null)).toEqual({
			view: "PRECERT",
			interactive: true,
		})
	})
	it("keeps the invoice screen until an Aviso is started", () => {
		expect(resolveStepView("AVISO", false, null)).toEqual({
			view: "INVOICE",
			interactive: true,
		})
		expect(resolveStepView("AVISO", true, null)).toEqual({
			view: "AVISO",
			interactive: true,
		})
	})
	it("lets the invoice screen continue forward to the current stage", () => {
		expect(resolveStepView("AVISO", false, "AVISO")).toEqual({
			view: "AVISO",
			interactive: true,
		})
	})
	it("makes earlier reached steps read-only", () => {
		expect(resolveStepView("RELEASE", true, "AVISO")).toEqual({
			view: "AVISO",
			interactive: false,
		})
		expect(resolveStepView("RELEASE", true, "APPROVE")).toEqual({
			view: "APPROVE",
			interactive: false,
		})
	})
	it("ignores steps not yet reached, pre-approval steps and junk", () => {
		expect(resolveStepView("AVISO", true, "RELEASE").view).toBe("AVISO")
		expect(resolveStepView("RELEASE", true, "FIELD").view).toBe("RELEASE")
		expect(resolveStepView("PRECERT", true, "NOPE").view).toBe("PRECERT")
	})
})

describe("panelForStep", () => {
	it("folds pre-approval steps into Approve and Released into Release", () => {
		expect(panelForStep("INTAKE")).toBe("APPROVE")
		expect(panelForStep("FIELD")).toBe("APPROVE")
		expect(panelForStep("APPROVE")).toBe("APPROVE")
		expect(panelForStep("INVOICE")).toBe("INVOICE")
		expect(panelForStep("RELEASED")).toBe("RELEASE")
	})
})

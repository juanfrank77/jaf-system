import { describe, expect, it } from "vitest"
import type { DocStatus } from "../../generated/prisma/client"
import {
	checkAvisoMatch,
	deriveGuideProgress,
	deriveGuideStep,
	deriveSupervisorStage,
	evaluateReleaseGate,
	isReturnsReconciled,
	nothingExpectedBack,
	type SupervisorStage,
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
})

describe("returns reconciliation", () => {
	it("treats no materials as nothing expected back", () => {
		expect(nothingExpectedBack(null, null)).toBe(true)
		expect(isReturnsReconciled(null, null, null)).toBe(true)
	})
	it("treats fully used materials as nothing expected back", () => {
		const taken = [{ serviceCodeId: "sc-1", qty: 10 }]
		const used = [{ serviceCodeId: "sc-1", qty: 10 }]
		expect(nothingExpectedBack(taken, used)).toBe(true)
		expect(isReturnsReconciled(taken, used, null)).toBe(true)
	})
	it("requires warehouse returns when material is expected back", () => {
		const taken = [{ serviceCodeId: "sc-1", qty: 10 }]
		const used = [{ serviceCodeId: "sc-1", qty: 7 }]
		expect(isReturnsReconciled(taken, used, null)).toBe(false)
	})
	it("accepts a short with its line note as reconciled", () => {
		const taken = [{ serviceCodeId: "sc-1", qty: 10 }]
		const used = [{ serviceCodeId: "sc-1", qty: 7 }]
		const returned = [
			{
				serviceCodeId: "sc-1",
				takenQty: 10,
				returnedQty: 2,
				notes: "two units missing",
			},
		]
		expect(isReturnsReconciled(taken, used, returned)).toBe(true)
	})
	it("rejects a short without a note", () => {
		const taken = [{ serviceCodeId: "sc-1", qty: 10 }]
		const used = [{ serviceCodeId: "sc-1", qty: 7 }]
		const returned = [
			{ serviceCodeId: "sc-1", takenQty: 10, returnedQty: 2, notes: "" },
		]
		expect(isReturnsReconciled(taken, used, returned)).toBe(false)
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
		materialsTaken: [],
		materialsUsed: [],
		materialsReturned: null,
	}
	const sheet = { sigSupervisorAt: now, sigSubcontractorAt: now }
	const photos = [{ tag: "BEFORE" as const }, { tag: "AFTER" as const }]

	it("passes all seven gate items and prerequisites", () => {
		const r = evaluateReleaseGate(good, sheet, photos)
		expect(r.ok).toBe(true)
		expect(r.releaseOk).toBe(true)
		expect(r.conditions.map((c) => c.key)).toEqual([
			"approved",
			"invoice",
			"aviso",
			"amount_match",
			"photos",
			"precert_signed",
			"returns_reconciled",
		])
		expect(r.prerequisites.map((p) => p.key)).toEqual(["contractor_code"])
	})

	it.each([
		["approved", { supervisorApprovedAt: null }],
		["invoice", { jafInvoiceGeneratedAt: null }],
		["aviso", { avisoDocPath: null }],
		["amount_match", { avisoMatchedAt: null }],
		[
			"returns_reconciled",
			{ materialsTaken: [{ serviceCodeId: "x", qty: 5 }] },
		],
	])("fails gate item %s", (key, patch) => {
		const r = evaluateReleaseGate({ ...good, ...patch }, sheet, photos)
		expect(r.ok).toBe(false)
		expect(r.conditions.find((c) => c.key === key)?.ok).toBe(false)
	})

	it("blocks release when contractor_code prerequisite fails despite seven green", () => {
		const r = evaluateReleaseGate(
			{ ...good, contractorAccountCode: null },
			sheet,
			photos,
		)
		expect(r.ok).toBe(true)
		expect(r.releaseOk).toBe(false)
		expect(r.prerequisites.find((p) => p.key === "contractor_code")?.ok).toBe(
			false,
		)
	})

	it("passes returns_reconciled when warehouse logged exact returns", () => {
		const r = evaluateReleaseGate(
			{
				...good,
				materialsTaken: [{ serviceCodeId: "sc-1", qty: 10 }],
				materialsUsed: [{ serviceCodeId: "sc-1", qty: 7 }],
				materialsReturned: [
					{
						serviceCodeId: "sc-1",
						takenQty: 10,
						returnedQty: 3,
						notes: "",
					},
				],
			},
			sheet,
			photos,
		)
		expect(r.conditions.find((c) => c.key === "returns_reconciled")?.ok).toBe(
			true,
		)
	})
})

describe("supervisorStageToGuideStep", () => {
	it("maps nine stages onto the guide's 1–8 strip (legacy — step 3 omitted)", () => {
		expect(supervisorStageToGuideStep("INTAKE")).toBe(1)
		expect(supervisorStageToGuideStep("WAREHOUSE")).toBe(2)
		expect(supervisorStageToGuideStep("FIELD")).toBe(4)
		expect(supervisorStageToGuideStep("APPROVE")).toBe(5)
	})
})

const tsNull = {
	jafInvoiceGeneratedAt: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
} as const

const progressCases: Array<
	[
		string,
		{
			status: DocStatus
			jafInvoiceGeneratedAt: Date | null
			avisoMatchedAt: Date | null
			releasedToFinanceAt: Date | null
		},
		number | null,
		boolean,
	]
> = [
	["CREATED", { status: "CREATED", ...tsNull }, 2, false],
	["PREPPED", { status: "PREPPED", ...tsNull }, 3, false],
	["SIGNED", { status: "SIGNED", ...tsNull }, 4, false],
	["SIGNED send-back", { status: "SIGNED", ...tsNull }, 4, false],
	["FIELD_UPDATED", { status: "FIELD_UPDATED", ...tsNull }, 5, false],
	[
		"SUPERVISOR_APPROVED no invoice",
		{ status: "SUPERVISOR_APPROVED", ...tsNull },
		6,
		false,
	],
	[
		"SUPERVISOR_APPROVED invoice only",
		{
			status: "SUPERVISOR_APPROVED",
			jafInvoiceGeneratedAt: now,
			avisoMatchedAt: null,
			releasedToFinanceAt: null,
		},
		7,
		false,
	],
	[
		"SUPERVISOR_APPROVED matched not released",
		{
			status: "SUPERVISOR_APPROVED",
			jafInvoiceGeneratedAt: now,
			avisoMatchedAt: now,
			releasedToFinanceAt: null,
		},
		8,
		false,
	],
	[
		"released",
		{
			status: "CLARO_UPLOADED",
			jafInvoiceGeneratedAt: now,
			avisoMatchedAt: now,
			releasedToFinanceAt: now,
		},
		8,
		true,
	],
	["CANCELLED", { status: "CANCELLED", ...tsNull }, null, false],
]

describe("deriveGuideProgress (work in progress)", () => {
	it.each(progressCases)("%s", (_label, job, current, allDone) => {
		const progress = deriveGuideProgress(job)
		if (current === null) {
			expect(progress).toBeNull()
		} else {
			expect(progress).toEqual({ current, allDone })
		}
		expect(deriveGuideStep(job)).toBe(current)
	})

	it("never decreases on the forward path", () => {
		const forward = [
			{ status: "CREATED" as const, ...tsNull },
			{ status: "PREPPED" as const, ...tsNull },
			{ status: "SIGNED" as const, ...tsNull },
			{ status: "FIELD_UPDATED" as const, ...tsNull },
			{ status: "SUPERVISOR_APPROVED" as const, ...tsNull },
			{
				status: "SUPERVISOR_APPROVED" as const,
				jafInvoiceGeneratedAt: now,
				avisoMatchedAt: null,
				releasedToFinanceAt: null,
			},
			{
				status: "CLARO_UPLOADED" as const,
				jafInvoiceGeneratedAt: now,
				avisoMatchedAt: now,
				releasedToFinanceAt: null,
			},
			{
				status: "CLARO_UPLOADED" as const,
				jafInvoiceGeneratedAt: now,
				avisoMatchedAt: now,
				releasedToFinanceAt: now,
			},
		]
		let prev = 0
		for (const job of forward) {
			const step = deriveGuideStep(job)
			expect(step).not.toBeNull()
			expect(step!).toBeGreaterThanOrEqual(prev)
			prev = step!
		}
	})

	it("send-back returns to step 4 from step 5", () => {
		expect(deriveGuideStep({ status: "FIELD_UPDATED", ...tsNull })).toBe(5)
		expect(deriveGuideStep({ status: "SIGNED", ...tsNull })).toBe(4)
	})

	it("sets allDone only when released", () => {
		expect(
			deriveGuideProgress({
				status: "CLARO_UPLOADED",
				jafInvoiceGeneratedAt: now,
				avisoMatchedAt: now,
				releasedToFinanceAt: null,
			})?.allDone,
		).toBe(false)
		expect(
			deriveGuideProgress({
				status: "CLARO_UPLOADED",
				jafInvoiceGeneratedAt: now,
				avisoMatchedAt: now,
				releasedToFinanceAt: now,
			})?.allDone,
		).toBe(true)
	})
})

describe("deriveSupervisorStage unchanged", () => {
	it.each([
		["CREATED", "none", tsNull, "INTAKE"],
		["FIELD_UPDATED", "none", tsNull, "APPROVE"],
		["SUPERVISOR_APPROVED", "none", tsNull, "INVOICE"],
	] as const satisfies ReadonlyArray<
		[DocStatus, string, typeof tsNull, SupervisorStage]
	>)("status=%s timestamps=%s → %s", (status, _label, ts, expectedStage) => {
		const doc = {
			status,
			supervisorApprovedAt: status === "SUPERVISOR_APPROVED" ? now : null,
			...ts,
		}
		expect(deriveSupervisorStage(doc, null)).toBe(expectedStage)
	})
})

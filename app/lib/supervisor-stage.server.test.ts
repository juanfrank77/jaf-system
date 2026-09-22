import { describe, expect, it } from "vitest"
import type { DocStatus } from "../../generated/prisma/client"
import {
	checkAvisoMatch,
	deriveGuideStep,
	deriveSupervisorStage,
	evaluateReleaseGate,
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
	it("maps nine stages onto the guide's 1–8 strip (legacy — step 3 omitted)", () => {
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

const tsNone = {
	jafInvoiceGeneratedAt: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
} as const
const tsJaf = {
	jafInvoiceGeneratedAt: now,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
} as const
const tsAviso = {
	jafInvoiceGeneratedAt: now,
	avisoMatchedAt: now,
	releasedToFinanceAt: null,
} as const
const tsReleased = {
	jafInvoiceGeneratedAt: now,
	avisoMatchedAt: now,
	releasedToFinanceAt: now,
} as const

const timestampPresets = [
	["none", tsNone],
	["jaf", tsJaf],
	["aviso", tsAviso],
	["released", tsReleased],
] as const

const forwardStatuses: DocStatus[] = [
	"CREATED",
	"PREPPED",
	"SIGNED",
	"FIELD_UPDATED",
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_REQUEST_GENERATED",
]

function expectedGuideStep(
	status: DocStatus,
	ts: typeof tsNone | typeof tsJaf | typeof tsAviso | typeof tsReleased,
): number | null {
	if (status === "CANCELLED") return null
	const base: Record<Exclude<DocStatus, "CANCELLED">, number> = {
		CREATED: 1,
		PREPPED: 2,
		SIGNED: 3,
		FIELD_UPDATED: 4,
		SUPERVISOR_APPROVED: 5,
		CLARO_UPLOADED: 5,
		LC_REQUEST_GENERATED: 5,
	}
	let step = base[status]
	if (ts.jafInvoiceGeneratedAt) step = Math.max(step, 6)
	if (ts.avisoMatchedAt) step = Math.max(step, 7)
	if (ts.releasedToFinanceAt) step = Math.max(step, 8)
	return step
}

describe("deriveGuideStep", () => {
	it.each(
		forwardStatuses.flatMap((status) =>
			timestampPresets.map(([label, ts]) => [status, label, ts] as const),
		),
	)("status=%s timestamps=%s", (status, _label, ts) => {
		const job = { status, ...ts }
		expect(deriveGuideStep(job)).toBe(expectedGuideStep(status, ts))
	})

	it("returns null for CANCELLED regardless of timestamps", () => {
		expect(deriveGuideStep({ status: "CANCELLED", ...tsReleased })).toBeNull()
	})

	it("reaches every guide step 1–8", () => {
		const reached = new Set<number>()
		for (const status of forwardStatuses) {
			for (const [, ts] of timestampPresets) {
				const step = deriveGuideStep({ status, ...ts })
				if (step !== null) reached.add(step)
			}
		}
		expect([...reached].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
	})

	it("never decreases along a normal lifecycle", () => {
		const lifecycle = [
			{ status: "CREATED" as const, ...tsNone },
			{ status: "PREPPED" as const, ...tsNone },
			{ status: "SIGNED" as const, ...tsNone },
			{ status: "FIELD_UPDATED" as const, ...tsNone },
			{ status: "SUPERVISOR_APPROVED" as const, ...tsNone },
			{ status: "SUPERVISOR_APPROVED" as const, ...tsJaf },
			{ status: "CLARO_UPLOADED" as const, ...tsAviso },
			{ status: "CLARO_UPLOADED" as const, ...tsReleased },
		]
		let prev = 0
		for (const job of lifecycle) {
			const step = deriveGuideStep(job)
			expect(step).not.toBeNull()
			expect(step!).toBeGreaterThanOrEqual(prev)
			prev = step!
		}
	})

	it.each([
		["CREATED", "none", tsNone, "INTAKE"],
		["CREATED", "jaf", tsJaf, "AVISO"],
		["CREATED", "aviso", tsAviso, "RELEASE"],
		["CREATED", "released", tsReleased, "RELEASED"],
		["PREPPED", "none", tsNone, "WAREHOUSE"],
		["PREPPED", "jaf", tsJaf, "AVISO"],
		["PREPPED", "aviso", tsAviso, "RELEASE"],
		["PREPPED", "released", tsReleased, "RELEASED"],
		["SIGNED", "none", tsNone, "FIELD"],
		["SIGNED", "jaf", tsJaf, "AVISO"],
		["SIGNED", "aviso", tsAviso, "RELEASE"],
		["SIGNED", "released", tsReleased, "RELEASED"],
		["FIELD_UPDATED", "none", tsNone, "APPROVE"],
		["FIELD_UPDATED", "jaf", tsJaf, "AVISO"],
		["FIELD_UPDATED", "aviso", tsAviso, "RELEASE"],
		["FIELD_UPDATED", "released", tsReleased, "RELEASED"],
		["SUPERVISOR_APPROVED", "none", tsNone, "INVOICE"],
		["SUPERVISOR_APPROVED", "jaf", tsJaf, "AVISO"],
		["SUPERVISOR_APPROVED", "aviso", tsAviso, "RELEASE"],
		["SUPERVISOR_APPROVED", "released", tsReleased, "RELEASED"],
		["CLARO_UPLOADED", "none", tsNone, "INVOICE"],
		["CLARO_UPLOADED", "jaf", tsJaf, "AVISO"],
		["CLARO_UPLOADED", "aviso", tsAviso, "RELEASE"],
		["CLARO_UPLOADED", "released", tsReleased, "RELEASED"],
		["LC_REQUEST_GENERATED", "none", tsNone, "INVOICE"],
		["LC_REQUEST_GENERATED", "jaf", tsJaf, "AVISO"],
		["LC_REQUEST_GENERATED", "aviso", tsAviso, "RELEASE"],
		["LC_REQUEST_GENERATED", "released", tsReleased, "RELEASED"],
	] as const satisfies ReadonlyArray<
		[
			DocStatus,
			string,
			typeof tsNone | typeof tsJaf | typeof tsAviso | typeof tsReleased,
			SupervisorStage,
		]
	>)(
		"deriveSupervisorStage unchanged for status=%s timestamps=%s → %s",
		(status, _label, ts, expectedStage) => {
			const doc = {
				status,
				supervisorApprovedAt:
					status === "SUPERVISOR_APPROVED" ||
					status === "CLARO_UPLOADED" ||
					status === "LC_REQUEST_GENERATED"
						? now
						: null,
				...ts,
			}
			const sheet =
				ts.avisoMatchedAt || ts.releasedToFinanceAt
					? { sigSupervisorAt: now, sigSubcontractorAt: now }
					: null
			expect(deriveSupervisorStage(doc, sheet)).toBe(expectedStage)
		},
	)
})

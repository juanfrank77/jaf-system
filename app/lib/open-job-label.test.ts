import { describe, expect, it } from "vitest"
import type { DocStatus } from "../../generated/prisma/client"
import { OPEN_JOB_LABEL_KEYS, openJobLabel } from "./open-job-label"

const D = new Date("2026-10-18T12:00:00Z")
const signed = { sigSupervisorAt: D, sigSubcontractorAt: D }
const unsigned = { sigSupervisorAt: D, sigSubcontractorAt: null }

type Doc = Parameters<typeof openJobLabel>[0]
const doc = (status: DocStatus, over: Partial<Doc> = {}): Doc => ({
	status,
	fieldStartedAt: null,
	supervisorApprovedAt: null,
	jafInvoiceGeneratedAt: null,
	avisoMatchedAt: null,
	releasedToFinanceAt: null,
	...over,
})

describe("openJobLabel", () => {
	it.each([
		["CREATED", {}, null, "MATERIAL_REQUESTED"],
		["PREPPED", {}, null, "READY_FOR_PICKUP"],
		["SIGNED", { fieldStartedAt: null }, null, "PICKED_UP"],
		["SIGNED", { fieldStartedAt: D }, null, "FIELD"],
		["FIELD_UPDATED", { supervisorApprovedAt: null }, null, "SIGN_OFF"],
		["SUPERVISOR_APPROVED", { supervisorApprovedAt: D }, null, "READY_TO_SEND"],
		[
			"SUPERVISOR_APPROVED",
			{ supervisorApprovedAt: D, jafInvoiceGeneratedAt: D },
			null,
			"SENT_WAITING_AVISO",
		],
		[
			"SUPERVISOR_APPROVED",
			{ supervisorApprovedAt: D, jafInvoiceGeneratedAt: D, avisoMatchedAt: D },
			unsigned,
			"PRECERT",
		],
		[
			"SUPERVISOR_APPROVED",
			{ supervisorApprovedAt: D, jafInvoiceGeneratedAt: D, avisoMatchedAt: D },
			signed,
			"RELEASE",
		],
		[
			"SUPERVISOR_APPROVED",
			{
				supervisorApprovedAt: D,
				jafInvoiceGeneratedAt: D,
				avisoMatchedAt: D,
				releasedToFinanceAt: D,
			},
			signed,
			"RELEASED",
		],
	] as const)("%s %j -> %s", (status, over, sheet, expected) => {
		expect(openJobLabel(doc(status, over), sheet)).toBe(expected)
	})

	it("is Sign off, not Field, once the supervisor finishes Field", () => {
		expect(
			openJobLabel(doc("FIELD_UPDATED", { fieldStartedAt: D }), null),
		).toBe("SIGN_OFF")
	})

	it("has a distinct locale key for every label", () => {
		const keys = Object.values(OPEN_JOB_LABEL_KEYS)
		expect(new Set(keys).size).toBe(10)
		for (const k of keys) expect(k).toMatch(/^open_job\./)
	})
})

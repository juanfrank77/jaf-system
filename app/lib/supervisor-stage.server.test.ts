import { describe, expect, it } from "vitest"
import {
	deriveSupervisorStage,
	isAvisoStarted,
	isPreCertSigned,
	panelForStep,
	resolveStepView,
	SUPERVISOR_STAGES,
	supervisorStepHref,
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
		expect(resolveStepView("PRECERT", true, null, false)).toEqual({
			view: "PRECERT",
			interactive: true,
		})
	})
	it("keeps the invoice screen until an Aviso is started", () => {
		expect(resolveStepView("AVISO", false, null, false)).toEqual({
			view: "INVOICE",
			interactive: true,
		})
		expect(resolveStepView("AVISO", true, null, false)).toEqual({
			view: "AVISO",
			interactive: true,
		})
	})
	it("lets the invoice screen continue forward to the current stage", () => {
		expect(resolveStepView("AVISO", false, "AVISO", false)).toEqual({
			view: "AVISO",
			interactive: true,
		})
	})
	it("makes earlier reached steps read-only", () => {
		expect(resolveStepView("RELEASE", true, "AVISO", false)).toEqual({
			view: "AVISO",
			interactive: false,
		})
		expect(resolveStepView("RELEASE", true, "APPROVE", false)).toEqual({
			view: "APPROVE",
			interactive: false,
		})
	})
	it("keeps the Aviso screen interactive from Pre-cert until a Pre-cert signature", () => {
		expect(resolveStepView("PRECERT", false, "AVISO", false)).toEqual({
			view: "AVISO",
			interactive: true,
		})
		expect(resolveStepView("PRECERT", false, "AVISO", true)).toEqual({
			view: "AVISO",
			interactive: false,
		})
		// Pre-cert itself and earlier steps are unaffected.
		expect(
			resolveStepView("PRECERT", false, "INVOICE", false).interactive,
		).toBe(false)
		expect(resolveStepView("PRECERT", false, null, true).interactive).toBe(true)
	})
	it("ignores steps not yet reached, pre-approval steps and junk", () => {
		expect(resolveStepView("AVISO", true, "RELEASE", false).view).toBe("AVISO")
		expect(resolveStepView("RELEASE", true, "FIELD", false).view).toBe(
			"RELEASE",
		)
		expect(resolveStepView("PRECERT", true, "NOPE", false).view).toBe("PRECERT")
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

describe("supervisorStepHref", () => {
	it("sends Intake and Warehouse to the job page and Field to the Field screen", () => {
		expect(supervisorStepHref("d1", "INTAKE")).toBe("/docs/d1")
		expect(supervisorStepHref("d1", "WAREHOUSE")).toBe("/docs/d1")
		expect(supervisorStepHref("d1", "FIELD")).toBe("/docs/d1/field")
	})

	it("opens Sign off onward on the review screen at the job's own step", () => {
		expect(supervisorStepHref("d1", "AVISO")).toBe("/docs/d1/review?step=AVISO")
	})

	it("a job waiting on the Aviso opens on Step 6, not Step 5", () => {
		const url = new URL(supervisorStepHref("d1", "AVISO"), "http://x")
		const step = url.searchParams.get("step")
		// No legacy Aviso lines saved: the default view would be Step 5.
		expect(resolveStepView("AVISO", false, null, false).view).toBe("INVOICE")
		expect(resolveStepView("AVISO", false, step, false)).toEqual({
			view: "AVISO",
			interactive: true,
		})
	})

	it("every review-screen step lands on its own step in the rail", () => {
		for (const stage of SUPERVISOR_STAGES.slice(3)) {
			const step = new URL(
				supervisorStepHref("d1", stage),
				"http://x",
			).searchParams.get("step")
			expect(resolveStepView(stage, false, step, false).view).toBe(stage)
		}
	})
})

describe("isPreCertSigned", () => {
	it("is true with any Pre-cert signature: supervisor, sub-contractor or Claro", () => {
		const none = {
			sigSupervisorAt: null,
			sigSubcontractorAt: null,
			sigClaroAt: null,
		}
		expect(isPreCertSigned(null)).toBe(false)
		expect(isPreCertSigned(none)).toBe(false)
		expect(isPreCertSigned({ ...none, sigSupervisorAt: new Date() })).toBe(true)
		expect(isPreCertSigned({ ...none, sigSubcontractorAt: new Date() })).toBe(
			true,
		)
		// A Claro-only signature counts too: nothing downstream may be signed.
		expect(isPreCertSigned({ ...none, sigClaroAt: new Date() })).toBe(true)
	})
})

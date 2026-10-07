// The comptroller's three payments on a job (Carmen's file, mockup v3):
// the PBCC advance from the bank, the crew payment, and Claro's final
// payment. Upstream finance creates every row she sees; her screens only
// record that the money moved, so each payment is one step of the
// `ComptrollerStepRail` (mockup v3 priority 3).
export type ComptrollerStep = "ADVANCE" | "CREW" | "FINAL"

export const COMPTROLLER_STEPS: ComptrollerStep[] = ["ADVANCE", "CREW", "FINAL"]

/** i18n key per step, inside the `comptroller_flow.step` namespace. */
export const COMPTROLLER_STEP_LABEL_KEY = {
	ADVANCE: "comptroller_flow.step.advance",
	CREW: "comptroller_flow.step.crew",
	FINAL: "comptroller_flow.step.final",
} as const

/** The first payment still to record, or `null` once all three are in. */
export function nextComptrollerStep(recorded: {
	advanceReceived: boolean
	crewPaid: boolean
	finalReceived: boolean
}): ComptrollerStep | null {
	if (!recorded.advanceReceived) return "ADVANCE"
	if (!recorded.crewPaid) return "CREW"
	if (!recorded.finalReceived) return "FINAL"
	return null
}

import { useTranslation } from "react-i18next"
import { SUPERVISOR_STAGES, type SupervisorStage } from "~/lib/supervisor-stage"
import { StepRail } from "./step-rail"

const LABEL_KEYS = {
	INTAKE: "step_rail.intake",
	WAREHOUSE: "step_rail.warehouse",
	FIELD: "step_rail.field",
	APPROVE: "step_rail.approve",
	INVOICE: "step_rail.invoice",
	AVISO: "step_rail.aviso",
	PRECERT: "step_rail.precert",
	RELEASE: "step_rail.release",
	RELEASED: "step_rail.released",
} as const

// `stage` is how far the job has actually got; `view` is the step on screen.
// Reached supervisor steps (Approve onward) link back to their read-only
// screen.
export function SupervisorStepRail({
	stage,
	view = stage,
}: {
	stage: SupervisorStage
	view?: SupervisorStage
}) {
	const { t } = useTranslation()
	const reached = SUPERVISOR_STAGES.indexOf(stage)
	const first = SUPERVISOR_STAGES.indexOf("APPROVE")
	const steps = SUPERVISOR_STAGES.map((s, i) => ({
		key: s,
		label: t(LABEL_KEYS[s]),
		href: i >= first && i <= reached ? `?step=${s}` : undefined,
	}))
	return (
		<StepRail
			steps={steps}
			current={SUPERVISOR_STAGES.indexOf(view)}
			ariaLabel={t("step_rail.aria")}
		/>
	)
}

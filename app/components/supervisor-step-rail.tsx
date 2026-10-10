import { useTranslation } from "react-i18next"
import { STAGE_LABEL_KEYS } from "~/lib/doc-stage"
import { SUPERVISOR_STAGES, type SupervisorStage } from "~/lib/supervisor-stage"
import { StepRail } from "./step-rail"

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
		label: t(STAGE_LABEL_KEYS[s]),
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

import { useTranslation } from "react-i18next"
import {
	COMPTROLLER_STEP_LABEL_KEY,
	COMPTROLLER_STEPS,
	type ComptrollerStep,
} from "~/lib/comptroller-steps"
import { StepRail } from "./step-rail"

// The comptroller's payment rail. All three payments are hers (`mine`).
// `current` is the next payment still to record on this job; `null` (the
// dashboard, which spans many jobs, or a job with everything recorded)
// leaves no step highlighted.
export function ComptrollerStepRail({
	current,
}: {
	current: ComptrollerStep | null
}) {
	const { t } = useTranslation()
	return (
		<StepRail
			ariaLabel={t("comptroller_flow.aria")}
			current={current ? COMPTROLLER_STEPS.indexOf(current) : -1}
			steps={COMPTROLLER_STEPS.map((step) => ({
				key: step,
				label: t(COMPTROLLER_STEP_LABEL_KEY[step]),
				mine: true,
			}))}
		/>
	)
}

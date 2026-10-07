import { useTranslation } from "react-i18next"
import {
	COMPLETION_LABEL_KEY,
	COMPLETION_STEPS,
	type CompletionStep,
} from "~/lib/installer-steps"
import { StepRail } from "./step-rail"

// The four-step new-completion rail. Unlike the loop rail, steps ahead
// of the current one are not linked — you cannot skip a capture step,
// and the rail shows how far along this job is.
export function CompletionStepRail({ current }: { current: CompletionStep }) {
	const { t } = useTranslation()
	const index = COMPLETION_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("installer.installer_flow.completion.aria")}
			current={index}
			steps={COMPLETION_STEPS.map((step, i) => ({
				key: step,
				label: t(COMPLETION_LABEL_KEY[step]),
				href: i === index ? undefined : undefined,
				mine: true,
			}))}
		/>
	)
}

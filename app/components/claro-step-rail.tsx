import { useTranslation } from "react-i18next"
import { CLARO_STEPS, type ClaroStep } from "~/lib/claro-steps"
import { StepRail } from "./step-rail"

/** The Arm B rail: Load, Review, Generate, Submit, Close. With a PO in hand,
 * steps behind the current one link back to it; without one only Load does. */
export function ClaroStepRail({
	current,
	poId,
}: {
	current: ClaroStep
	poId?: string
}) {
	const { t } = useTranslation()
	const labels = [
		t("claro.step.load"),
		t("claro.step.review"),
		t("claro.step.generate"),
		t("claro.step.submit"),
		t("claro.step.close"),
	]
	return (
		<StepRail
			ariaLabel={t("claro.aria")}
			current={current - 1}
			phoneSummary
			steps={CLARO_STEPS.map((key, i) => ({
				key,
				label: labels[i],
				mine: true,
				href:
					i + 1 >= current
						? undefined
						: i === 0 || !poId
							? "/finance/claro"
							: `/finance/claro/${poId}?step=${key}`,
			}))}
		/>
	)
}

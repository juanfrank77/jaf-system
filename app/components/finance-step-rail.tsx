import { useTranslation } from "react-i18next"
import {
	FINANCE_STEP_HREF,
	FINANCE_STEP_LABEL_KEY,
	FINANCE_STEPS,
	type FinanceStep,
} from "~/lib/finance-steps"
import { StepRail } from "./step-rail"

// The finance loop rail: every step is finance's own work (`mine`), the
// screen you are on is the current step, and the others link back to
// their list. Packets, payroll and POs arrive in any order across
// different jobs, so steps after the current one stay navigable rather
// than locked.
export function FinanceStepRail({ current }: { current: FinanceStep }) {
	const { t } = useTranslation()
	const index = FINANCE_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("finance_flow.aria")}
			current={index}
			steps={FINANCE_STEPS.map((step, i) => ({
				key: step,
				href: i === index ? undefined : FINANCE_STEP_HREF[step],
				label: t(FINANCE_STEP_LABEL_KEY[step]),
				mine: true,
			}))}
		/>
	)
}

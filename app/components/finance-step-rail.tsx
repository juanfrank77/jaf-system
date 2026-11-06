import { useTranslation } from "react-i18next"
import {
	FINANCE_STEP_HREF,
	FINANCE_STEP_LABEL_KEY,
	FINANCE_STEPS,
	type FinanceStep,
} from "~/lib/finance-steps"
import { StepRail } from "./step-rail"

// Arm A rail: every step is finance's own work (`mine`), the screen you are on
// is the current step, the others link to their own screen. Packets, batches
// and payroll move at different speeds across different jobs, so steps after
// the current one stay navigable rather than locked.
export function FinanceStepRail({
	current,
}: {
	current: FinanceStep | "CLOSED"
}) {
	const { t } = useTranslation()
	const index =
		current === "CLOSED" ? FINANCE_STEPS.length : FINANCE_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("finance_flow.aria")}
			current={index}
			steps={[
				...FINANCE_STEPS.map((step, i) => ({
					key: step,
					href: i === index ? undefined : FINANCE_STEP_HREF[step],
					label: t(FINANCE_STEP_LABEL_KEY[step]),
					mine: true,
				})),
				// Where Arm A ends once Carmen has paid: the finished Avisos.
				{
					key: "CLOSED",
					href: current === "CLOSED" ? undefined : "/finance/closed",
					label: t("finance_flow.step.closed"),
					mine: true,
				},
			]}
		/>
	)
}

/** "Arm A · Stage 3 of 3" label shown beside the title. */
export function StageChip(props: { arm: "A"; step: number; total: number }) {
	const { t } = useTranslation()
	return (
		<span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
			{t("finance_flow.chip_a", { step: props.step, total: props.total })}
		</span>
	)
}

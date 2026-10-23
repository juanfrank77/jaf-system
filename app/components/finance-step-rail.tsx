import { useTranslation } from "react-i18next"
import {
	ARM_B_STEP_AVAILABLE,
	ARM_B_STEP_HREF,
	ARM_B_STEP_LABEL_KEY,
	ARM_B_STEPS,
	type ArmBStep,
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
export function FinanceStepRail({ current }: { current: FinanceStep }) {
	const { t } = useTranslation()
	const index = FINANCE_STEPS.indexOf(current)
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
				// Where Arm A ends once Carmen has paid: a marker, never a screen.
				{ key: "CLOSED", label: t("finance_flow.step.closed"), locked: true },
			]}
		/>
	)
}

// Arm B rail: Awaiting PO and Awaiting Ariba are not built yet, so they render
// locked (greyed, never a link).
export function ArmBStepRail({ current }: { current: ArmBStep }) {
	const { t } = useTranslation()
	const index = ARM_B_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("finance_flow.arm_b.aria")}
			current={index}
			steps={ARM_B_STEPS.map((step, i) => ({
				key: step,
				href: i === index ? undefined : ARM_B_STEP_HREF[step],
				label: t(ARM_B_STEP_LABEL_KEY[step]),
				mine: true,
				locked: !ARM_B_STEP_AVAILABLE[step] && i !== index,
			}))}
		/>
	)
}

/** "Arm A · Stage 3 of 3" / "Arm B · Receivables" label shown beside the title. */
export function StageChip(
	props: { arm: "A"; step: number; total: number } | { arm: "B"; name: string },
) {
	const { t } = useTranslation()
	return (
		<span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
			{props.arm === "A"
				? t("finance_flow.chip_a", { step: props.step, total: props.total })
				: t("finance_flow.chip_b", { name: props.name })}
		</span>
	)
}

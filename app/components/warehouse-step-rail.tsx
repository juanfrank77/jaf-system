import { useTranslation } from "react-i18next"
import {
	WAREHOUSE_STEP_HREF,
	WAREHOUSE_STEP_LABEL_KEY,
	WAREHOUSE_STEPS,
	type WarehouseStep,
} from "~/lib/warehouse-steps"
import { StepRail } from "./step-rail"

// The warehouse loop rail: every step is the warehouse's own work
// (`mine`), every reached screen links back to it, and the screen
// you are on is the current step. The loop is circular in practice
// (a unit can come back at any time), so unlike a per-job rail the
// steps after the current one stay navigable rather than locked.
export function WarehouseStepRail({ current }: { current: WarehouseStep }) {
	const { t } = useTranslation()
	const index = WAREHOUSE_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("warehouse_flow.aria")}
			current={index}
			steps={WAREHOUSE_STEPS.map((step, i) => ({
				key: step,
				href: i === index ? undefined : WAREHOUSE_STEP_HREF[step],
				label: t(WAREHOUSE_STEP_LABEL_KEY[step]),
				mine: true,
			}))}
		/>
	)
}

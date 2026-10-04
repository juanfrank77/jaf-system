import { useTranslation } from "react-i18next"
import { SUPERVISOR_STAGES, type SupervisorStage } from "~/lib/supervisor-stage"
import { cn } from "~/lib/utils"

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

export function StepRail({ stage }: { stage: SupervisorStage }) {
	const { t } = useTranslation()
	const current = SUPERVISOR_STAGES.indexOf(stage)
	return (
		<ol
			className="flex flex-wrap gap-1 text-xs"
			aria-label={t("step_rail.aria")}
		>
			{SUPERVISOR_STAGES.map((s, i) => (
				<li
					key={s}
					aria-current={i === current ? "step" : undefined}
					className={cn(
						"px-2 py-1 rounded-full border",
						i < current &&
							"bg-status-ok-soft border-status-ok/30 text-status-ok",
						i === current &&
							"bg-primary border-primary text-primary-foreground font-medium",
						i > current && "bg-card border-border text-muted-foreground",
					)}
				>
					{i + 1}. {t(LABEL_KEYS[s])}
				</li>
			))}
		</ol>
	)
}

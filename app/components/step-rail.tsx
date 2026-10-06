import { useTranslation } from "react-i18next"
import { Link } from "react-router"
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

// `stage` is how far the job has actually got; `view` is the step on screen.
// Reached supervisor steps (Approve onward) link back to their read-only
// screen.
export function StepRail({
	stage,
	view = stage,
}: {
	stage: SupervisorStage
	view?: SupervisorStage
}) {
	const { t } = useTranslation()
	const current = SUPERVISOR_STAGES.indexOf(view)
	const reached = SUPERVISOR_STAGES.indexOf(stage)
	const first = SUPERVISOR_STAGES.indexOf("APPROVE")
	return (
		<ol
			className="flex flex-wrap gap-1 text-xs"
			aria-label={t("step_rail.aria")}
		>
			{SUPERVISOR_STAGES.map((s, i) => {
				const label = (
					<>
						{i + 1}. {t(LABEL_KEYS[s])}
					</>
				)
				const lookBack = i >= first && i <= reached && i !== current
				return (
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
						{lookBack ? (
							<Link to={`?step=${s}`} className="hover:underline">
								{label}
							</Link>
						) : (
							label
						)}
					</li>
				)
			})}
		</ol>
	)
}

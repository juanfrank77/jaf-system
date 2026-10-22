import { useTranslation } from "react-i18next"
import { STAGE_LABEL_KEYS } from "~/lib/doc-stage"
import { SUPERVISOR_STAGES, type SupervisorStage } from "~/lib/supervisor-stage"
import { StepRail } from "./step-rail"

// `stage` is how far the job has actually got; `view` is the step on screen.
// With a `docId`, every reached step links back: Approve onward to its
// read-only review screen, and Intake / Warehouse / Field (which have no
// screen of their own) to the job page that holds their details. The links
// are absolute so they work from either page; on the job page itself the
// early steps stay plain text, since that page is where they would lead.
// A job whose materials do not come from the warehouse (`warehouseSkipped`)
// shows the Warehouse step as "Not required", never linked.
export function SupervisorStepRail({
	stage,
	view = stage,
	docId,
	page = "review",
	warehouseSkipped = false,
}: {
	stage: SupervisorStage
	view?: SupervisorStage
	docId?: string
	page?: "review" | "job"
	warehouseSkipped?: boolean
}) {
	const { t } = useTranslation()
	const reached = SUPERVISOR_STAGES.indexOf(stage)
	const first = SUPERVISOR_STAGES.indexOf("APPROVE")
	const skipped = (step: SupervisorStage) =>
		warehouseSkipped && step === "WAREHOUSE"
	const hrefFor = (step: SupervisorStage, i: number) => {
		if (!docId || i > reached || skipped(step)) return undefined
		if (i >= first) return `/docs/${docId}/review?step=${step}`
		return page === "job" ? undefined : `/docs/${docId}`
	}
	const steps = SUPERVISOR_STAGES.map((s, i) => ({
		key: s,
		label: skipped(s)
			? `${t(STAGE_LABEL_KEYS[s])} · ${t("job_flow.step.not_required")}`
			: t(STAGE_LABEL_KEYS[s]),
		href: hrefFor(s, i),
	}))
	return (
		<StepRail
			steps={steps}
			current={SUPERVISOR_STAGES.indexOf(view)}
			ariaLabel={t("step_rail.aria")}
			phoneSummary
		/>
	)
}

import { useTranslation } from "react-i18next"
import {
	canViewJobStep,
	isJobStepMine,
	JOB_STEP_HREF,
	JOB_STEP_LABEL_KEY,
	JOB_STEPS,
	type JobStep,
} from "~/lib/job-steps"
import type { Role } from "../../generated/prisma/client"
import { StepRail } from "./step-rail"

// The per-job rail from mockup v3: every job screen shows the same
// lifecycle, with the viewer's own steps bolded ("You") and the
// supervisor/finance tail locked. Steps the viewer's role cannot
// open stay unlinked — grey steps "happen to the job, not to you" —
// and reached steps link back to their screen.
export function JobStepRail({
	docId,
	current,
	role,
}: {
	docId: string
	current: JobStep
	role: Role
}) {
	const { t } = useTranslation()
	const index = JOB_STEPS.indexOf(current)
	return (
		<StepRail
			ariaLabel={t("job_flow.aria")}
			current={index}
			steps={JOB_STEPS.map((step, i) => {
				const accessible = canViewJobStep(role, step)
				return {
					key: step,
					href:
						accessible && i !== index ? JOB_STEP_HREF[step](docId) : undefined,
					label: t(JOB_STEP_LABEL_KEY[step]),
					locked: step === "CLOSE" && !accessible,
					mine: isJobStepMine(role, step),
				}
			})}
		/>
	)
}

/** The same lifecycle with no step current: the role's landing screens
 * (dashboard, My Jobs) show where "you" come in. Grey steps happen to the job,
 * not to the viewer. */
export function JobFlowOverview({
	viewer,
	current,
	compact = false,
	hrefs,
}: {
	viewer: Role
	/** The step on screen, when the rail sits on a step's screen rather than a landing page. */
	current?: JobStep
	compact?: boolean
	/** Landing pages for steps that have one outside a single job. */
	hrefs?: Partial<Record<JobStep, string>>
}) {
	const { t } = useTranslation()
	return (
		<StepRail
			ariaLabel={t("job_flow.aria")}
			current={current ? JOB_STEPS.indexOf(current) : -1}
			compact={compact}
			steps={JOB_STEPS.map((step) => ({
				key: step,
				href: hrefs?.[step],
				label: t(JOB_STEP_LABEL_KEY[step]),
				locked: step === "CLOSE" && !canViewJobStep(viewer, step),
				mine: isJobStepMine(viewer, step),
			}))}
		/>
	)
}

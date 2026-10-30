import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import { STAGE_BADGE_VARIANT, STAGE_LABEL_KEYS } from "~/lib/doc-stage"
import { OPEN_JOB_LABEL_KEYS, type OpenJobLabel } from "~/lib/open-job-label"
import type { SupervisorStage } from "~/lib/supervisor-stage"

/** The one status chip: the job's current step, same label for every role. */
export function DocStageBadge({
	stage,
	openLabel,
	cancelled = false,
	className,
}: {
	stage: SupervisorStage
	/** The finer supervisor-facing label (`openJobLabel`); the stage still
	 * picks the colour (except Returned, always red), and is the text when no
	 * label is given. */
	openLabel?: OpenJobLabel
	/** A cancelled job has no live step; show that instead. */
	cancelled?: boolean
	className?: string
}) {
	const { t } = useTranslation()
	return (
		<Badge
			variant={
				// Cancelled, or a packet Finance sent back: both are red.
				cancelled || openLabel === "RETURNED"
					? "danger"
					: STAGE_BADGE_VARIANT[stage]
			}
			className={className}
		>
			{cancelled
				? t("docs_status.cancelled")
				: t(
						openLabel
							? OPEN_JOB_LABEL_KEYS[openLabel]
							: STAGE_LABEL_KEYS[stage],
					)}
		</Badge>
	)
}

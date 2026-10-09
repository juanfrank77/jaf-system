import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import { STAGE_BADGE_VARIANT, STAGE_LABEL_KEYS } from "~/lib/doc-stage"
import type { SupervisorStage } from "~/lib/supervisor-stage"

/** The one status chip: the job's current step, same label for every role. */
export function DocStageBadge({
	stage,
	cancelled = false,
	className,
}: {
	stage: SupervisorStage
	/** A cancelled job has no live step; show that instead. */
	cancelled?: boolean
	className?: string
}) {
	const { t } = useTranslation()
	return (
		<Badge
			variant={cancelled ? "danger" : STAGE_BADGE_VARIANT[stage]}
			className={className}
		>
			{cancelled ? t("docs_status.cancelled") : t(STAGE_LABEL_KEYS[stage])}
		</Badge>
	)
}

import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { DashboardDocRow } from "~/components/dashboard-doc-list"
import { JobFlowOverview } from "~/components/job-step-rail"
import { PageHeader } from "~/components/ui/page-header"
import {
	WarehouseDocList,
	type WarehouseRowKind,
} from "~/components/warehouse-doc-list"
import type { JobStep } from "~/lib/job-steps"
import {
	WAREHOUSE_JOB_STEP_HREF,
	type WAREHOUSE_QUEUE_LABEL_KEY,
} from "~/lib/warehouse-queues"

type TitleKey =
	(typeof WAREHOUSE_QUEUE_LABEL_KEY)[keyof typeof WAREHOUSE_QUEUE_LABEL_KEY]

// The job-rail step each queue page is: Prep, Pickup (Release) and Returns.
const QUEUE_STEP: Partial<Record<WarehouseRowKind, JobStep>> = {
	prep: "PREP",
	release: "RELEASE",
	returns: "RETURN",
}

/** A warehouse step page: title (no count; that lives on the sidebar link), the job rail on the step, and the step's list. */
export function WarehouseQueuePage({
	titleKey,
	kind,
	docs,
	children,
}: {
	titleKey: TitleKey
	kind: WarehouseRowKind
	docs: DashboardDocRow[]
	children?: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<PageHeader title={t(titleKey)} />
			<JobFlowOverview
				viewer="WAREHOUSE"
				current={QUEUE_STEP[kind]}
				hrefs={WAREHOUSE_JOB_STEP_HREF}
			/>
			<WarehouseDocList docs={docs} kind={kind} />
			{children}
		</div>
	)
}

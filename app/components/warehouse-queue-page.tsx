import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { DashboardDocRow } from "~/components/dashboard-doc-list"
import { PageHeader } from "~/components/ui/page-header"
import {
	WarehouseDocList,
	type WarehouseRowKind,
} from "~/components/warehouse-doc-list"
import type { WAREHOUSE_QUEUE_LABEL_KEY } from "~/lib/warehouse-queues"

type TitleKey =
	(typeof WAREHOUSE_QUEUE_LABEL_KEY)[keyof typeof WAREHOUSE_QUEUE_LABEL_KEY]

/** A warehouse step page: title (no count; that lives on the sidebar link) and the step's list. */
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
			<WarehouseDocList docs={docs} kind={kind} />
			{children}
		</div>
	)
}

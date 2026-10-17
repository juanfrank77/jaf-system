import { useTranslation } from "react-i18next"
import { Stat } from "~/components/ui/stat"
import {
	NO_WAREHOUSE_COUNTS,
	WAREHOUSE_QUEUES,
	type WarehouseQueue,
	warehouseQueueHref,
} from "~/lib/warehouse-queues"

export function WarehouseCountCards({
	counts = NO_WAREHOUSE_COUNTS,
}: {
	counts?: Record<WarehouseQueue, number>
}) {
	const { t } = useTranslation()
	return (
		<div className="grid grid-cols-3 gap-3">
			{WAREHOUSE_QUEUES.map((queue) => (
				<Stat
					key={queue}
					label={t(`dashboard.warehouse_${queue}_stat`)}
					value={counts[queue]}
					href={warehouseQueueHref(queue)}
				/>
			))}
		</div>
	)
}

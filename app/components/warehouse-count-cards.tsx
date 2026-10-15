import { useTranslation } from "react-i18next"
import { Stat } from "~/components/ui/stat"
import type { WarehouseQueue } from "~/lib/warehouse-queues"
import { WAREHOUSE_QUEUES, warehouseQueueHref } from "~/lib/warehouse-queues"

export function WarehouseCountCards({
	counts = { prep: 0, release: 0, returns: 0 },
}: {
	counts?: Record<WarehouseQueue, number>
}) {
	const { t } = useTranslation()
	return (
		<>
			{WAREHOUSE_QUEUES.map((queue) => (
				<Stat
					key={queue}
					label={t(`dashboard.warehouse_${queue}_stat`)}
					value={counts[queue]}
					href={warehouseQueueHref(queue)}
				/>
			))}
		</>
	)
}

import { useTranslation } from "react-i18next"
import { DashboardView } from "~/components/dashboard-view"
import { JobFlowOverview } from "~/components/job-step-rail"
import { Callout } from "~/components/ui/callout"
import { WarehouseCountCards } from "~/components/warehouse-count-cards"
import type {
	BaseDashboardProps,
	DashboardViewProps,
	WarehouseOnlyKeys,
} from "./types"

export function WarehouseDashboard(
	props: BaseDashboardProps & Pick<DashboardViewProps, WarehouseOnlyKeys>,
) {
	const { t } = useTranslation()
	const { warehouseCounts = { prep: 0, release: 0, returns: 0 }, ...rest } =
		props
	return (
		<DashboardView
			{...rest}
			showBilling={false}
			showDocList={false}
			intro={
				<div className="space-y-3">
					<WarehouseCountCards counts={warehouseCounts} />
					<JobFlowOverview viewer="WAREHOUSE" />
					<Callout title={t("job_flow.callout.warehouse_list_title")}>
						{t("job_flow.callout.warehouse_list_body")}
					</Callout>
				</div>
			}
		/>
	)
}

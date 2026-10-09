import { useTranslation } from "react-i18next"
import { DashboardView } from "~/components/dashboard-view"
import { JobFlowOverview } from "~/components/job-step-rail"
import { Callout } from "~/components/ui/callout"
import type {
	BaseDashboardProps,
	DashboardViewProps,
	WarehouseOnlyKeys,
} from "./types"

export function WarehouseDashboard(
	props: BaseDashboardProps & Pick<DashboardViewProps, WarehouseOnlyKeys>,
) {
	const { t } = useTranslation()
	return (
		<DashboardView
			{...props}
			showBilling={false}
			showDocList={false}
			intro={
				<div className="space-y-3">
					<JobFlowOverview viewer="WAREHOUSE" />
					<Callout title={t("job_flow.callout.warehouse_list_title")}>
						{t("job_flow.callout.warehouse_list_body")}
					</Callout>
				</div>
			}
		/>
	)
}

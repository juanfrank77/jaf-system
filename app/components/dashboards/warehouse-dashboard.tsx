import { DashboardView } from "~/components/dashboard-view"
import type {
	BaseDashboardProps,
	DashboardViewProps,
	WarehouseOnlyKeys,
} from "./types"

export function WarehouseDashboard(
	props: BaseDashboardProps & Pick<DashboardViewProps, WarehouseOnlyKeys>,
) {
	return <DashboardView {...props} />
}

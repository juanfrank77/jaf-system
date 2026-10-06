import { DashboardView } from "~/components/dashboard-view"
import type {
	BaseDashboardProps,
	CrewOnlyKeys,
	DashboardViewProps,
} from "./types"

export function CrewDashboard(
	props: BaseDashboardProps & Pick<DashboardViewProps, CrewOnlyKeys>,
) {
	return <DashboardView {...props} showBilling={false} />
}

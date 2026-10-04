import { DashboardView } from "~/components/dashboard-view"
import type { BaseDashboardProps } from "./types"

export function AdminDashboard(props: BaseDashboardProps) {
	return <DashboardView {...props} />
}

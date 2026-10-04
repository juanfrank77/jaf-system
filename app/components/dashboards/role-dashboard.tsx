import { DashboardView } from "~/components/dashboard-view"
import type { Role } from "../../../generated/prisma/client"
import { AdminDashboard } from "./admin-dashboard"
import { CrewDashboard } from "./crew-dashboard"
import { FinanceDashboard } from "./finance-dashboard"
import { InstallerDashboard } from "./installer-dashboard"
import {
	SupervisorDashboard,
	type SupervisorQueues,
	type SupervisorScope,
} from "./supervisor-dashboard"
import type { DashboardViewProps } from "./types"
import { WarehouseDashboard } from "./warehouse-dashboard"

type RoleDashboardProps = DashboardViewProps & {
	role: Role
	supervisorQueues: SupervisorQueues | null
	supervisorScope?: SupervisorScope | null
}

export function RoleDashboard({
	role,
	supervisorQueues,
	supervisorScope = null,
	...view
}: RoleDashboardProps) {
	if (role === "SUPERVISOR" && supervisorQueues) {
		return (
			<SupervisorDashboard
				queues={supervisorQueues}
				scope={supervisorScope}
				view={view}
			/>
		)
	}
	switch (role) {
		case "CREW":
			return <CrewDashboard {...view} />
		case "WAREHOUSE":
			return <WarehouseDashboard {...view} />
		case "FINANCE":
			return <FinanceDashboard {...view} />
		case "ADMIN":
			return <AdminDashboard {...view} />
		case "INSTALLER":
		case "INSTALLER_SUPERVISOR":
			return <InstallerDashboard {...view} />
		default:
			// COMPTROLLER with the feature flag off lands here (the loader redirects
			// it to /comptroller when the flag is on).
			return <DashboardView {...view} />
	}
}

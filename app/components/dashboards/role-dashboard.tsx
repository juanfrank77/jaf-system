import { DashboardView } from "~/components/dashboard-view"
import type { FinanceHome } from "~/lib/finance-home"
import type { SupervisorQueue } from "~/lib/supervisor-queues"
import type { Role } from "../../../generated/prisma/client"
import { AdminDashboard } from "./admin-dashboard"
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
	/** Lissette's six-box Home; without it Finance falls back to the generic view. */
	financeHome?: FinanceHome | null
	/** The supervisor's sidebar queue (`?stage=`), when one is selected. */
	stageQueue?: SupervisorQueue | null
}

export function RoleDashboard({
	role,
	supervisorQueues,
	supervisorScope = null,
	financeHome = null,
	stageQueue = null,
	...view
}: RoleDashboardProps) {
	if (role === "SUPERVISOR" && supervisorQueues) {
		return (
			<SupervisorDashboard
				queues={supervisorQueues}
				scope={supervisorScope}
				stageQueue={stageQueue}
				view={view}
			/>
		)
	}
	switch (role) {
		case "WAREHOUSE":
			return <WarehouseDashboard {...view} />
		case "FINANCE":
			return <FinanceDashboard {...view} financeHome={financeHome} />
		case "ADMIN":
			return <AdminDashboard {...view} />
		case "INSTALLER":
		case "INSTALLER_SUPERVISOR":
			return <InstallerDashboard {...view} />
		default:
			// COMPTROLLER (to /comptroller) and CREW (to the crew notice) are
			// redirected by the loader; this branch is a fallback.
			return <DashboardView {...view} />
	}
}

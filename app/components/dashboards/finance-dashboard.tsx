import { DashboardView } from "~/components/dashboard-view"
import { FinanceHomeView } from "~/components/finance-home"
import type { FinanceHome } from "~/lib/finance-home"
import type { BaseDashboardProps } from "./types"

export function FinanceDashboard({
	financeHome = null,
	...props
}: BaseDashboardProps & { financeHome?: FinanceHome | null }) {
	if (financeHome) return <FinanceHomeView home={financeHome} />
	return <DashboardView {...props} financeSteps />
}

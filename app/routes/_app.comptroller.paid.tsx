import { useTranslation } from "react-i18next"
import { ComptrollerRequestTabs } from "~/components/comptroller-request-tabs"
import { ComptrollerRunsTable } from "~/components/comptroller-runs-table"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Card, CardContent } from "~/components/ui/card"
import { loadComptrollerRuns } from "~/lib/comptroller-runs.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.paid"

export const meta: Route.MetaFunction = () => [
	{ title: "Comptroller · paid_runs — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const { paid } = await loadComptrollerRuns()
	return { runs: paid }
}

export default function ComptrollerPaid({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<div className="p-6 space-y-4">
			<h1 className="text-2xl font-bold">
				{t("app_shell.nav.comptroller_to_pay")}
			</h1>
			<ComptrollerRequestTabs tab="paid" />
			<Card>
				<CardContent className="p-0">
					<ComptrollerRunsTable runs={loaderData.runs} />
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}

import { useTranslation } from "react-i18next"
import { ComptrollerRunsTable } from "~/components/comptroller-runs-table"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent } from "~/components/ui/card"
import { loadComptrollerRuns } from "~/lib/comptroller-runs.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller"

export const meta: Route.MetaFunction = () => [
	{ title: "Brigades · payroll — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const { toPay, paid } = await loadComptrollerRuns()
	return { user, toPay, paid }
}

export default function ComptrollerPayroll({
	loaderData,
}: Route.ComponentProps) {
	const { toPay, paid } = loaderData
	const { t } = useTranslation()
	return (
		<div className="p-6 space-y-4">
			<h1 className="text-2xl font-bold">{t("comptroller_payroll.title")}</h1>
			<Callout title={t("comptroller_payroll.callout_title")}>
				{t("comptroller_payroll.callout_body")}
			</Callout>
			<Card>
				<CardContent className="p-0">
					<h2 className="p-3 text-sm font-semibold border-b">
						{t("comptroller_payroll.runs_to_pay")}
					</h2>
					<ComptrollerRunsTable runs={toPay} />
				</CardContent>
			</Card>
			<Card>
				<CardContent className="p-0">
					<h2 className="p-3 text-sm font-semibold border-b">
						{t("comptroller_payroll.paid_runs")}
					</h2>
					<ComptrollerRunsTable runs={paid} />
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
